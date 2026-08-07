/*
 * Serpent ufbx → GLB bridge.
 *
 * Compiled together with ufbx.c (MIT, see scripts/ufbx-wasm-lock.json) to a
 * platform-independent WASM module used by the Library Worker
 * (src/worker/fbx/wasm-loader.ts). Parses an FBX file in memory with ufbx and
 * packs a compact descriptor that the TypeScript side turns into a glTF 2.0
 * GLB (src/worker/fbx/glb-builder.ts):
 *
 *   - geometry: per-corner positions/normals/UVs + per-material triangle runs
 *   - materials: PBR (metallic-roughness) with legacy Lambert/Phong fallback
 *   - textures: embedded content bytes + external relative filenames
 *   - transforms: per mesh instance, node->geometry_to_world (column-major)
 *
 * Space conversion: axes → glTF convention (right-handed Y-up), units → meters,
 * with UFBX_SPACE_CONVERSION_MODIFY_GEOMETRY so vertex data and winding are
 * already baked into target space; node transforms stay consistent with that.
 *
 * Output layout: [u32 JSON length (LE)] [JSON descriptor (UTF-8, no NUL)]
 * [binary blobs...]. The JSON references blob byte offsets that are relative to
 * the start of the *blob section* (offset 0 = first byte after the JSON text);
 * the JS side knows the JSON length from the prefix and adds it when slicing
 * the packed buffer.
 *
 * Exported API (see EXPORTED_FUNCTIONS in build-ufbx-wasm.mjs):
 *   int         serpent_parse(const uint8_t *fbx, size_t fbx_size, const char *opts_json)
 *   const char *serpent_error(void)        // JSON error descriptor after failure
 *   uint8_t    *serpent_out_ptr(void)
 *   size_t      serpent_out_size(void)
 *   void        serpent_free_out(void)
 *
 * Thread-safety: this module keeps singleton output state, so callers must
 * serialize conversions (the JS side holds a single-flight queue).
 */
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "ufbx.h"

#define SERPENT_MAX_OUTPUT_BYTES (1u << 30) /* 1 GiB hard cap, defense in depth */
#define SERPENT_ERROR_BUF_SIZE 4096
#define SERPENT_MAX_PARTS 1024
#define SERPENT_MAX_TEXTURES 256

typedef struct {
	uint8_t *data;
	size_t size;
	size_t cap;
} serpent_buf;

typedef struct {
	serpent_buf json;   /* descriptor text (working buffer) */
	serpent_buf bin;    /* binary blobs (working buffer) */
	serpent_buf packed; /* final contiguous [u32 len][JSON][blobs] */
} serpent_result;

typedef struct {
	uint32_t max_triangles; /* 0 = unlimited */
	uint64_t max_output_bytes;
	char filename[4096];
	size_t filename_len;
} serpent_opts;

static serpent_result g_result;
static char g_error[SERPENT_ERROR_BUF_SIZE];
static int g_error_used;
static int g_texture_emitted[SERPENT_MAX_TEXTURES];
static const ufbx_texture *g_missing_emitted[64];

/* Forward declarations (defined at the bottom; serpent_parse uses them). */
int serpent_parse(const uint8_t *fbx_data, size_t fbx_size, const char *opts_json);
const char *serpent_error(void);
uint8_t *serpent_out_ptr(void);
size_t serpent_out_size(void);
void serpent_free_out(void);

/* ------------------------------------------------------------------ */
/* Small JSON writer                                                   */
/* ------------------------------------------------------------------ */

static void buf_reserve(serpent_buf *buf, size_t extra)
{
	if (buf->size + extra <= buf->cap) return;
	size_t cap = buf->cap ? buf->cap : 4096;
	while (cap < buf->size + extra) cap *= 2;
	if (cap > SERPENT_MAX_OUTPUT_BYTES) cap = SERPENT_MAX_OUTPUT_BYTES;
	if (cap < buf->size + extra) return; /* clamp; caller's append will be dropped */
	uint8_t *data = (uint8_t *)realloc(buf->data, cap);
	if (!data) {
		buf->cap = 0;
		return;
	}
	buf->data = data;
	buf->cap = cap;
}

static void buf_append(serpent_buf *buf, const void *data, size_t size)
{
	buf_reserve(buf, size);
	if (buf->cap < buf->size + size) return;
	memcpy(buf->data + buf->size, data, size);
	buf->size += size;
}

static void jappend(serpent_buf *buf, const char *text)
{
	buf_append(buf, text, strlen(text));
}

static void jappend_int(serpent_buf *buf, long long value)
{
	char tmp[32];
	int len = snprintf(tmp, sizeof(tmp), "%lld", value);
	buf_append(buf, tmp, (size_t)len);
}

static void jappend_double(serpent_buf *buf, double value)
{
	if (!(value == value) || value > 1e18 || value < -1e18) value = 0.0;
	char tmp[64];
	int len = snprintf(tmp, sizeof(tmp), "%.9g", value);
	buf_append(buf, tmp, (size_t)len);
}

static void jappend_string(serpent_buf *buf, const char *data, size_t len)
{
	static const char hex[] = "0123456789abcdef";
	uint8_t quote = (uint8_t)'"';
	buf_append(buf, &quote, 1);
	for (size_t i = 0; i < len; i++) {
		uint8_t c = (uint8_t)data[i];
		switch (c) {
		case '"': jappend(buf, "\\\""); break;
		case '\\': jappend(buf, "\\\\"); break;
		case '\b': jappend(buf, "\\b"); break;
		case '\f': jappend(buf, "\\f"); break;
		case '\n': jappend(buf, "\\n"); break;
		case '\r': jappend(buf, "\\r"); break;
		case '\t': jappend(buf, "\\t"); break;
		default:
			if (c < 0x20) {
				char tmp[7] = { '\\', 'u', '0', '0', hex[c >> 4], hex[c & 0xf], 0 };
				jappend(buf, tmp);
			} else {
				buf_append(buf, &c, 1);
			}
			break;
		}
	}
	quote = (uint8_t)'"';
	buf_append(buf, &quote, 1);
}

static void jappend_str_c(serpent_buf *buf, const char *text)
{
	jappend_string(buf, text, text ? strlen(text) : 0);
}

static size_t align8(size_t value)
{
	return (value + 7) & ~(size_t)7;
}

/* Append a blob to the binary section, padded so the next blob starts 8-aligned. */
static void blob_append(serpent_buf *bin, const void *data, size_t size)
{
	static const uint8_t zero[8] = {0};
	size_t padding = align8(bin->size) - bin->size;
	if (padding) buf_append(bin, zero, padding);
	buf_append(bin, data, size);
}

/* ------------------------------------------------------------------ */
/* Options parsing (minimal; only the keys the JS side sends)         */
/* ------------------------------------------------------------------ */

static void parse_opts(const char *json, serpent_opts *opts)
{
	memset(opts, 0, sizeof(*opts));
	opts->max_output_bytes = SERPENT_MAX_OUTPUT_BYTES;
	if (!json) return;

	const char *p = json;
	while (*p) {
		while (*p && *p != '"') p++;
		if (!*p) break;
		const char *key = ++p;
		while (*p && *p != '"') p++;
		if (!*p) break;
		size_t key_len = (size_t)(p - key);
		/* Skip the key's closing quote, then the colon and whitespace. Do NOT
		 * consume the value's opening quote: string values start with one and
		 * the filename branch checks `*p == '"'`. */
		if (*p == '"') p++;
		while (*p && (*p == ':' || *p == ' ' || *p == '\t')) p++;

		if (key_len == 12 && memcmp(key, "maxTriangles", 12) == 0) {
			opts->max_triangles = (uint32_t)strtoul(p, NULL, 10);
		} else if (key_len == 15 && memcmp(key, "maxOutputBytes", 15) == 0) {
			opts->max_output_bytes = strtoull(p, NULL, 10);
		} else if (key_len == 8 && memcmp(key, "filename", 8) == 0 && *p == '"') {
			const char *start = ++p;
			while (*p && *p != '"') p++;
			size_t len = (size_t)(p - start);
			if (len > sizeof(opts->filename) - 1) len = sizeof(opts->filename) - 1;
			memcpy(opts->filename, start, len);
			opts->filename[len] = '\0';
			opts->filename_len = len;
			if (*p) p++;
			continue;
		}
		if (*p) p++;
	}
}

/* ------------------------------------------------------------------ */
/* Descriptor helpers                                                  */
/* ------------------------------------------------------------------ */

static size_t part_triangle_count(const ufbx_mesh *mesh, const ufbx_mesh_part *part)
{
	size_t count = 0;
	for (size_t i = 0; i < part->face_indices.count; i++) {
		uint32_t face_ix = part->face_indices.data[i];
		if (face_ix >= mesh->faces.count) continue;
		size_t n = mesh->faces.data[face_ix].num_indices;
		if (n >= 3) count += n - 2;
	}
	return count;
}

static int scene_total_triangles(const ufbx_scene *scene, size_t *total)
{
	*total = 0;
	for (size_t i = 0; i < scene->nodes.count; i++) {
		const ufbx_node *node = scene->nodes.data[i];
		if (!node->mesh || node->mesh->num_indices == 0) continue;
		const ufbx_mesh *mesh = node->mesh;
		if (mesh->material_parts.data) {
			for (size_t p = 0; p < mesh->material_parts.count; p++) {
				*total += part_triangle_count(mesh, &mesh->material_parts.data[p]);
			}
		} else {
			for (size_t f = 0; f < mesh->faces.count; f++) {
				size_t n = mesh->faces.data[f].num_indices;
				if (n >= 3) *total += n - 2;
			}
		}
	}
	return (uint64_t)*total <= (uint64_t)1 << 50 ? 0 : -1;
}

static int material_scene_index(const ufbx_scene *scene, const ufbx_material *material)
{
	if (!material) return -1;
	for (size_t i = 0; i < scene->materials.count; i++) {
		if (scene->materials.data[i] == material) return (int)i;
	}
	return -1;
}

static int texture_scene_index(const ufbx_scene *scene, const ufbx_texture *texture)
{
	if (!texture) return -1;
	for (size_t i = 0; i < scene->textures.count; i++) {
		if (scene->textures.data[i] == texture) return (int)i;
	}
	return -1;
}

/* ------------------------------------------------------------------ */
/* Material / texture emission                                         */
/* ------------------------------------------------------------------ */

static void emit_material(serpent_buf *j, const ufbx_material *mat, const ufbx_scene *scene)
{
	const ufbx_material_map *base_color = &mat->pbr.base_color;
	const ufbx_material_map *base_factor = &mat->pbr.base_factor;
	const ufbx_material_map *metalness = &mat->pbr.metalness;
	const ufbx_material_map *roughness = &mat->pbr.roughness;
	const ufbx_material_map *emission = &mat->pbr.emission_color;
	const ufbx_material_map *emission_factor = &mat->pbr.emission_factor;
	const ufbx_material_map *normal_map = &mat->pbr.normal_map;
	const ufbx_material_map *occlusion = &mat->pbr.ambient_occlusion;
	const ufbx_material_map *opacity = &mat->pbr.opacity;

	/* Legacy Lambert/Phong fallbacks when the PBR maps are absent. */
	bool has_pbr = mat->features.pbr.enabled;
	if (!has_pbr || !base_color->has_value) {
		const ufbx_material_map *diffuse = &mat->fbx.diffuse_color;
		if (diffuse->has_value && (base_color->texture == NULL || !base_color->has_value)) {
			base_color = diffuse;
		}
	}
	if (!has_pbr || !emission->has_value) {
		const ufbx_material_map *fbx_emission = &mat->fbx.emission_color;
		if (fbx_emission->has_value && (emission->texture == NULL || !emission->has_value)) {
			emission = fbx_emission;
			emission_factor = &mat->fbx.emission_factor;
		}
	}
	if (!has_pbr || !normal_map->texture) {
		const ufbx_material_map *fbx_normal = &mat->fbx.normal_map;
		if (fbx_normal->texture) normal_map = fbx_normal;
	}
	if (!has_pbr || !occlusion->texture) {
		const ufbx_material_map *fbx_ao = &mat->fbx.bump;
		if (fbx_ao->texture) occlusion = fbx_ao;
	}

	float r = 1.0f, g = 1.0f, b = 1.0f, a = 1.0f;
	if (base_color->has_value) {
		r = base_color->value_vec4.x;
		g = base_color->value_vec4.y;
		b = base_color->value_vec4.z;
		a = base_color->value_vec4.w;
	}
	float factor = base_factor->has_value ? (float)base_factor->value_real : 1.0f;
	r *= factor; g *= factor; b *= factor;

	float metal = metalness->has_value ? (float)metalness->value_real : 0.0f;
	float rough = roughness->has_value ? (float)roughness->value_real : 1.0f;

	float er = 0.0f, eg = 0.0f, eb = 0.0f;
	if (emission->has_value) {
		er = emission->value_vec3.x;
		eg = emission->value_vec3.y;
		eb = emission->value_vec3.z;
	}
	float efactor = emission_factor->has_value ? (float)emission_factor->value_real : 1.0f;
	er *= efactor; eg *= efactor; eb *= efactor;

	float normal_scale = 1.0f;
	if (normal_map->has_value) normal_scale = (float)normal_map->value_vec3.x;

	float op = opacity->has_value ? (float)opacity->value_real : 1.0f;
	a *= op;

	int base_color_tex = texture_scene_index(scene, base_color->texture);
	int metal_tex = texture_scene_index(scene, metalness->texture);
	int rough_tex = texture_scene_index(scene, roughness->texture);
	/* glTF packs metallic/roughness into one texture (G = roughness, B = metalness).
	 * Only emit it when both maps reference the same texture file. */
	int mr_tex = (metal_tex >= 0 && metal_tex == rough_tex) ? metal_tex : -1;
	int emission_tex = texture_scene_index(scene, emission->texture);
	int normal_tex = texture_scene_index(scene, normal_map->texture);
	int occlusion_tex = texture_scene_index(scene, occlusion->texture);
	int opacity_tex = texture_scene_index(scene, opacity->texture);

	jappend(j, "{\"name\":");
	jappend_str_c(j, mat->name.data);
	jappend(j, ",\"shaderType\":");
	jappend_int(j, (long long)mat->shader_type);
	jappend(j, ",\"baseColor\":[");
	jappend_double(j, r); jappend(j, ",");
	jappend_double(j, g); jappend(j, ",");
	jappend_double(j, b); jappend(j, ",");
	jappend_double(j, a);
	jappend(j, "],\"baseColorTexture\":");
	jappend_int(j, base_color_tex);
	jappend(j, ",\"metallic\":");
	jappend_double(j, metal);
	jappend(j, ",\"roughness\":");
	jappend_double(j, rough);
	jappend(j, ",\"metallicRoughnessTexture\":");
	jappend_int(j, mr_tex);
	/* Serpent-a5ic: separate-file metalness/roughness maps cannot ride the
	 * single glTF metallicRoughness slot; expose both scene indices so the
	 * JS converter can composite them (B = metalness, G = roughness). */
	jappend(j, ",\"metalnessTexture\":");
	jappend_int(j, metal_tex);
	jappend(j, ",\"roughnessTexture\":");
	jappend_int(j, rough_tex);
	jappend(j, ",\"hasMetalnessTexture\":");
	jappend_int(j, (metal_tex >= 0 && mr_tex < 0) ? 1 : 0);
	jappend(j, ",\"hasRoughnessTexture\":");
	jappend_int(j, (rough_tex >= 0 && mr_tex < 0) ? 1 : 0);
	jappend(j, ",\"emissive\":[");
	jappend_double(j, er); jappend(j, ",");
	jappend_double(j, eg); jappend(j, ",");
	jappend_double(j, eb);
	jappend(j, "],\"emissiveTexture\":");
	jappend_int(j, emission_tex);
	jappend(j, ",\"normalScale\":");
	jappend_double(j, normal_scale);
	jappend(j, ",\"normalTexture\":");
	jappend_int(j, normal_tex);
	jappend(j, ",\"occlusionTexture\":");
	jappend_int(j, occlusion_tex);
	jappend(j, ",\"opacityTexture\":");
	jappend_int(j, opacity_tex);
	jappend(j, ",\"doubleSided\":");
	jappend_int(j, mat->features.double_sided.enabled ? 1 : 0);
	jappend(j, ",\"alphaMode\":");
	bool has_alpha_tex = opacity_tex >= 0 || (base_color_tex >= 0 && a < 1.0f - 1e-5f);
	jappend_str_c(j, (a < 1.0f - 1e-5f || has_alpha_tex) ? "blend" : "opaque");
	jappend(j, ",\"limitations\":[");
	bool need_comma = false;
	if (has_alpha_tex) {
		jappend(j, "\"separate opacity map not representable in glTF\"");
		need_comma = true;
	}
	if (metal_tex >= 0 && mr_tex < 0) {
		jappend(j, need_comma ? "," : "");
		jappend(j, "\"metalness texture without matching roughness map\"");
		need_comma = true;
	}
	if (rough_tex >= 0 && mr_tex < 0) {
		jappend(j, need_comma ? "," : "");
		jappend(j, "\"roughness texture without matching metalness map\"");
	}
	jappend(j, "]}");
}

static void emit_texture(serpent_buf *j, serpent_buf *bin, const ufbx_texture *tex, int index, int *missing_count)
{
	jappend(j, "{\"index\":");
	jappend_int(j, index);
	jappend(j, ",\"name\":");
	jappend_str_c(j, tex->name.data);
	jappend(j, ",\"relativeFilename\":");
	jappend_string(j, tex->relative_filename.data ? tex->relative_filename.data : "", tex->relative_filename.length);
	jappend(j, ",\"absoluteFilename\":");
	jappend_string(j, tex->absolute_filename.data ? tex->absolute_filename.data : "", tex->absolute_filename.length);

	bool embedded = tex->content.data != NULL && tex->content.size > 0;
	jappend(j, ",\"embedded\":");
	jappend_int(j, embedded ? 1 : 0);
	if (embedded) {
		blob_append(bin, tex->content.data, tex->content.size);
		jappend(j, ",\"contentOffset\":");
		jappend_int(j, (long long)(bin->size - tex->content.size));
		jappend(j, ",\"contentSize\":");
		jappend_int(j, (long long)tex->content.size);
	} else {
		(*missing_count)++;
	}
	jappend(j, "}");
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

int serpent_parse(const uint8_t *fbx_data, size_t fbx_size, const char *opts_json)
{
	serpent_opts opts;
	parse_opts(opts_json, &opts);

	serpent_free_out();
	g_error_used = 0;
	memset(g_texture_emitted, 0, sizeof(g_texture_emitted));
	memset(g_missing_emitted, 0, sizeof(g_missing_emitted));

	ufbx_load_opts load_opts = {0};
	load_opts.target_axes = ufbx_axes_right_handed_y_up; /* glTF: X right, Y up, Z front */
	load_opts.target_unit_meters = 1.0f;                 /* glTF: meters */
	load_opts.space_conversion = UFBX_SPACE_CONVERSION_MODIFY_GEOMETRY;
	load_opts.generate_missing_normals = true;
	load_opts.load_external_files = true; /* geometry caches only; textures are read by JS */
	load_opts.ignore_missing_external_files = true;
	load_opts.use_blender_pbr_material = true;
	load_opts.node_depth_limit = 256;
	load_opts.filename.data = opts.filename;
	load_opts.filename.length = opts.filename_len;

	ufbx_error error = {0};
	ufbx_scene *scene = ufbx_load_memory(fbx_data, fbx_size, &load_opts, &error);
	if (!scene) {
		serpent_buf tmp = {0};
		jappend_string(&tmp, error.description.data ? error.description.data : "", error.description.length);
		int len = snprintf(g_error, sizeof(g_error),
			"{\"ok\":false,\"code\":\"parse\",\"ufbxType\":%d,\"message\":",
			(int)error.type);
		if (len > 0 && (size_t)len + tmp.size + 2 < sizeof(g_error)) {
			memcpy(g_error + len, tmp.data, tmp.size);
			size_t used = (size_t)len + tmp.size;
			g_error[used++] = '}';
			g_error[used] = '\0';
		} else {
			snprintf(g_error, sizeof(g_error),
				"{\"ok\":false,\"code\":\"parse\",\"ufbxType\":%d}", (int)error.type);
		}
		free(tmp.data);
		g_error_used = 1;
		return -1;
	}

	size_t total_triangles = 0;
	if (scene_total_triangles(scene, &total_triangles) != 0) {
		snprintf(g_error, sizeof(g_error),
			"{\"ok\":false,\"code\":\"limits\",\"message\":\"triangle count overflow\"}");
		g_error_used = 1;
		ufbx_free_scene(scene);
		return -1;
	}
	if (opts.max_triangles > 0 && total_triangles > opts.max_triangles) {
		snprintf(g_error, sizeof(g_error),
			"{\"ok\":false,\"code\":\"limits\",\"message\":\"too many triangles (%llu > %u)\"}",
			(unsigned long long)total_triangles, opts.max_triangles);
		g_error_used = 1;
		ufbx_free_scene(scene);
		return -1;
	}

	serpent_buf *j = &g_result.json;
	serpent_buf *bin = &g_result.bin;

	jappend(j, "{\"ok\":true,\"ufbxVersion\":\"");
	jappend_int(j, (long long)ufbx_version_major(UFBX_HEADER_VERSION));
	jappend(j, ".");
	jappend_int(j, (long long)ufbx_version_minor(UFBX_HEADER_VERSION));
	jappend(j, ".");
	jappend_int(j, (long long)ufbx_version_patch(UFBX_HEADER_VERSION));
	jappend(j, "\"");

	jappend(j, ",\"meta\":{\"sourceName\":");
	const char *base = strrchr(opts.filename, '/');
	if (!base) base = strrchr(opts.filename, '\\');
	const char *name = base ? base + 1 : opts.filename;
	jappend_str_c(j, name);
	jappend(j, ",\"unitMeters\":");
	jappend_double(j, scene->settings.unit_meters);
	jappend(j, ",\"originalAxisUp\":");
	jappend_int(j, (long long)scene->settings.original_axis_up);
	jappend(j, ",\"axes\":[");
	jappend_int(j, (long long)scene->settings.axes.right);
	jappend(j, ",");
	jappend_int(j, (long long)scene->settings.axes.up);
	jappend(j, ",");
	jappend_int(j, (long long)scene->settings.axes.front);
	jappend(j, "],\"totalTriangles\":");
	jappend_int(j, (long long)total_triangles);
	jappend(j, ",\"meshCount\":");
	size_t mesh_count = 0;
	for (size_t i = 0; i < scene->meshes.count; i++) {
		if (scene->meshes.data[i]->num_indices > 0) mesh_count++;
	}
	jappend_int(j, (long long)mesh_count);
	jappend(j, ",\"materialCount\":");
	jappend_int(j, (long long)scene->materials.count);
	jappend(j, ",\"instanceCount\":");
	size_t instance_count = 0;
	for (size_t i = 0; i < scene->nodes.count; i++) {
		if (scene->nodes.data[i]->mesh && scene->nodes.data[i]->mesh->num_indices > 0) instance_count++;
	}
	jappend_int(j, (long long)instance_count);
	jappend(j, "}");

	/* -- Meshes ------------------------------------------------------- */
	jappend(j, ",\"meshes\":[");
	size_t mesh_index = 0;
	for (size_t i = 0; i < scene->meshes.count; i++) {
		const ufbx_mesh *mesh = scene->meshes.data[i];
		if (mesh->num_indices == 0) continue;

		size_t corner_count = mesh->num_indices;
		bool has_normal = mesh->vertex_normal.exists && mesh->vertex_normal.indices.data != NULL;
		bool has_uv = mesh->vertex_uv.exists && mesh->vertex_uv.indices.data != NULL;

		/* Blob layout for this mesh, replicating blob_append alignment. */
		size_t pos_off = 0, normal_off = SIZE_MAX, uv_off = SIZE_MAX;
		size_t cursor = bin->size;
		#define SLOT(out, bytes) do { cursor = align8(cursor); (out) = cursor; cursor += (bytes); } while (0)
		SLOT(pos_off, corner_count * 3 * sizeof(float));
		if (has_normal) SLOT(normal_off, corner_count * 3 * sizeof(float));
		if (has_uv) SLOT(uv_off, corner_count * 2 * sizeof(float));
		size_t part_off[SERPENT_MAX_PARTS];
		size_t part_tri[SERPENT_MAX_PARTS];
		size_t num_parts = mesh->material_parts.data ? mesh->material_parts.count : 0;
		if (num_parts > SERPENT_MAX_PARTS) num_parts = SERPENT_MAX_PARTS;
		for (size_t p = 0; p < num_parts; p++) {
			part_tri[p] = part_triangle_count(mesh, &mesh->material_parts.data[p]);
			SLOT(part_off[p], part_tri[p] * 3 * sizeof(uint32_t));
		}
		#undef SLOT

		/* Append attribute blobs in layout order. */
		const ufbx_vertex_vec3 *pos = &mesh->vertex_position;
		const ufbx_vertex_vec3 *nor = &mesh->vertex_normal;
		const ufbx_vertex_vec2 *uv = &mesh->vertex_uv;
		size_t attr_cap = corner_count * 3;
		float *attr = (float *)malloc(attr_cap * sizeof(float));
		if (!attr) {
			snprintf(g_error, sizeof(g_error),
				"{\"ok\":false,\"code\":\"oom\",\"message\":\"out of memory\"}");
			g_error_used = 1;
			ufbx_free_scene(scene);
			return -1;
		}
		for (size_t c = 0; c < corner_count; c++) {
			ufbx_vec3 v = pos->values.data[pos->indices.data[c]];
			attr[c * 3 + 0] = (float)v.x;
			attr[c * 3 + 1] = (float)v.y;
			attr[c * 3 + 2] = (float)v.z;
		}
		blob_append(bin, attr, corner_count * 3 * sizeof(float));
		if (has_normal) {
			for (size_t c = 0; c < corner_count; c++) {
				ufbx_vec3 v = nor->values.data[nor->indices.data[c]];
				attr[c * 3 + 0] = (float)v.x;
				attr[c * 3 + 1] = (float)v.y;
				attr[c * 3 + 2] = (float)v.z;
			}
			blob_append(bin, attr, corner_count * 3 * sizeof(float));
		}
		if (has_uv) {
			for (size_t c = 0; c < corner_count; c++) {
				ufbx_vec2 v = uv->values.data[uv->indices.data[c]];
				attr[c * 2 + 0] = (float)v.x;
				/* Serpent-a5ic: FBX UV origin is bottom-left, glTF is
				 * top-left (GLTFLoader sets flipY=false). Flip V (v -> 1-v)
				 * or textures render upside-down and normal maps sample
				 * wrong — the "fragmented" look. Matches the FBX2glTF
				 * default behavior. */
				attr[c * 2 + 1] = 1.0f - (float)v.y;
			}
			blob_append(bin, attr, corner_count * 2 * sizeof(float));
		}
		free(attr);

		/* Append per-part index blobs using fan triangulation:
		 * face corners (b, b+1, ..., b+n-1) become triangles
		 * (b, b+k, b+k+1) for k in 1..n-2. Deterministic, no ufbx helper. */
		uint32_t *tri_buf = NULL;
		size_t tri_total = 0;
		for (size_t p = 0; p < num_parts; p++) tri_total += part_tri[p];
		if (tri_total > 0) {
			tri_buf = (uint32_t *)malloc(tri_total * 3 * sizeof(uint32_t));
			if (!tri_buf) {
				snprintf(g_error, sizeof(g_error),
					"{\"ok\":false,\"code\":\"oom\",\"message\":\"out of memory\"}");
				g_error_used = 1;
				ufbx_free_scene(scene);
				return -1;
			}
		}
		for (size_t p = 0; p < num_parts; p++) {
			const ufbx_mesh_part *part = &mesh->material_parts.data[p];
			size_t emit = 0;
			/* Serpent-a5ic: use ufbx's real triangulator instead of a hand
			 * written fan. The fan is wrong for concave polygons (complex DCC
			 * meshes inevitably contain them) which rendered textures
			 * "fragmented". ufbx_triangulate_face splits quads along the
			 * shortest diagonal with crossing detection and ear-clips ngons.
			 *
			 * NOTE: the ufbx.h comment says `(n-2)*3-1` indices are needed,
			 * but the implementation actually writes `(n-2)*3` (the `-1` is a
			 * legacy triangle-strip hint). Allocating the smaller size made
			 * the wasm32 output appear "corrupted" (heap overwrite) — the
			 * earlier fan workaround was a consequence of that. */
			size_t capacity = part_tri[p] * 3;
			for (size_t fi = 0; fi < part->face_indices.count; fi++) {
				uint32_t face_ix = part->face_indices.data[fi];
				if (face_ix >= mesh->faces.count) continue;
				ufbx_face face = mesh->faces.data[face_ix];
				if (face.num_indices < 3) continue;
				uint32_t n = face.num_indices;
				if (capacity < emit + (n - 2) * 3) continue;
				uint32_t num_tris = ufbx_triangulate_face(
					tri_buf + emit * 3, (n - 2) * 3, mesh, face);
				emit += num_tris;
			}
			if (emit > 0 && tri_buf) blob_append(bin, tri_buf, emit * 3 * sizeof(uint32_t));
		}
		free(tri_buf);

		/* Mesh JSON (offsets were computed against bin->size at entry). */
		if (mesh_index > 0) jappend(j, ",");
		jappend(j, "{\"index\":");
		jappend_int(j, (long long)mesh_index);
		jappend(j, ",\"name\":");
		jappend_str_c(j, mesh->name.data);
		jappend(j, ",\"cornerCount\":");
		jappend_int(j, (long long)corner_count);
		jappend(j, ",\"positionOffset\":");
		jappend_int(j, (long long)pos_off);
		jappend(j, ",\"normalOffset\":");
		jappend_int(j, (long long)normal_off);
		jappend(j, ",\"uvOffset\":");
		jappend_int(j, (long long)uv_off);
		jappend(j, ",\"totalTriangles\":");
		size_t mesh_tri = 0;
		for (size_t p = 0; p < num_parts; p++) mesh_tri += part_tri[p];
		jappend_int(j, (long long)mesh_tri);
		jappend(j, ",\"parts\":[");
		for (size_t p = 0; p < num_parts; p++) {
			int material_ix = -1;
			if (p < mesh->materials.count && mesh->materials.data[p]) {
				material_ix = material_scene_index(scene, mesh->materials.data[p]);
			} else if (mesh->materials.count > 0 && mesh->materials.data[0]) {
				material_ix = material_scene_index(scene, mesh->materials.data[0]);
			}
			if (p > 0) jappend(j, ",");
			jappend(j, "{\"materialIndex\":");
			jappend_int(j, material_ix);
			jappend(j, ",\"triangleCount\":");
			jappend_int(j, (long long)part_tri[p]);
			jappend(j, ",\"indexOffset\":");
			jappend_int(j, (long long)part_off[p]);
			jappend(j, "}");
		}
		jappend(j, "]}");
		mesh_index++;
	}
	jappend(j, "]");

	/* -- Instances ----------------------------------------------------- */
	jappend(j, ",\"instances\":[");
	size_t inst_ix = 0;
	for (size_t i = 0; i < scene->nodes.count; i++) {
		const ufbx_node *node = scene->nodes.data[i];
		if (!node->mesh || node->mesh->num_indices == 0) continue;
		/* Map through the same num_indices>0 filter used for meshes[]. */
		int emitted_mesh = -1;
		size_t emitted = 0;
		for (size_t m = 0; m < scene->meshes.count; m++) {
			const ufbx_mesh *mm = scene->meshes.data[m];
			if (mm->num_indices == 0) continue;
			if (mm == node->mesh) emitted_mesh = (int)emitted;
			emitted++;
		}
		if (emitted_mesh < 0) continue;
		if (inst_ix > 0) jappend(j, ",");
		inst_ix++;
		jappend(j, "{\"nodeName\":");
		jappend_str_c(j, node->name.data);
		jappend(j, ",\"meshIndex\":");
		jappend_int(j, emitted_mesh);
		jappend(j, ",\"transform\":[");
		const ufbx_matrix *m = &node->geometry_to_world;
		/* Column-major 4x4 (glTF layout). */
		jappend_double(j, m->m00); jappend(j, ",");
		jappend_double(j, m->m10); jappend(j, ",");
		jappend_double(j, m->m20); jappend(j, ",");
		jappend_double(j, 0.0); jappend(j, ",");
		jappend_double(j, m->m01); jappend(j, ",");
		jappend_double(j, m->m11); jappend(j, ",");
		jappend_double(j, m->m21); jappend(j, ",");
		jappend_double(j, 0.0); jappend(j, ",");
		jappend_double(j, m->m02); jappend(j, ",");
		jappend_double(j, m->m12); jappend(j, ",");
		jappend_double(j, m->m22); jappend(j, ",");
		jappend_double(j, 0.0); jappend(j, ",");
		jappend_double(j, m->m03); jappend(j, ",");
		jappend_double(j, m->m13); jappend(j, ",");
		jappend_double(j, m->m23); jappend(j, ",");
		jappend_double(j, 1.0);
		jappend(j, "]}");
	}
	jappend(j, "]");

	/* -- Materials ------------------------------------------------------ */
	jappend(j, ",\"materials\":[");
	for (size_t i = 0; i < scene->materials.count; i++) {
		if (i > 0) jappend(j, ",");
		emit_material(j, scene->materials.data[i], scene);
	}
	jappend(j, "]");

	/* -- Textures (only those referenced by materials, deduplicated) ---- */
	jappend(j, ",\"textures\":[");
	int missing_count = 0;
	int tex_ix = 0;
	for (size_t i = 0; i < scene->materials.count; i++) {
		const ufbx_material *mat = scene->materials.data[i];
		for (size_t t = 0; t < mat->textures.count; t++) {
			const ufbx_texture *tex = mat->textures.data[t].texture;
			if (!tex || tex->type != UFBX_TEXTURE_FILE) continue;
			int scene_ix = texture_scene_index(scene, tex);
			if (scene_ix < 0) continue;
			bool already = false;
			for (int k = 0; k < tex_ix; k++) {
				if (g_texture_emitted[k] == scene_ix) { already = true; break; }
			}
			if (already) continue;
			if (tex_ix >= SERPENT_MAX_TEXTURES) break;
			g_texture_emitted[tex_ix] = scene_ix;
			if (tex_ix > 0) jappend(j, ",");
			emit_texture(j, bin, tex, scene_ix, &missing_count);
			tex_ix++;
		}
	}
	jappend(j, "]");

	/* -- Missing texture filenames ------------------------------------- */
	jappend(j, ",\"missingTextures\":[");
	int miss_ix = 0;
	for (size_t i = 0; i < scene->materials.count && miss_ix < 64; i++) {
		const ufbx_material *mat = scene->materials.data[i];
		for (size_t t = 0; t < mat->textures.count; t++) {
			const ufbx_texture *tex = mat->textures.data[t].texture;
			if (!tex || tex->type != UFBX_TEXTURE_FILE) continue;
			if (tex->content.data && tex->content.size > 0) continue;
			bool already = false;
			for (int k = 0; k < miss_ix; k++) {
				if (g_missing_emitted[k] == tex) { already = true; break; }
			}
			if (already) continue;
			if (miss_ix >= 64) break;
			g_missing_emitted[miss_ix++] = tex;
			if (miss_ix > 1) jappend(j, ",");
			jappend_string(j, tex->relative_filename.data ? tex->relative_filename.data : "", tex->relative_filename.length);
		}
	}
	jappend(j, "]");

	/* -- Warnings -------------------------------------------------------- */
	jappend(j, ",\"warnings\":[");
	for (size_t i = 0; i < scene->metadata.warnings.count && i < 32; i++) {
		const ufbx_warning *warn = &scene->metadata.warnings.data[i];
		if (i > 0) jappend(j, ",");
		jappend_string(j, warn->description.data ? warn->description.data : "", warn->description.length);
	}
	jappend(j, "]}");

	/* Assemble the final packed output into one contiguous buffer so the JS
	 * side can treat it as [u32 json_len][JSON][binary blobs]. */
	{
		uint32_t json_len = (uint32_t)g_result.json.size;
		size_t total = g_result.json.size + g_result.bin.size;
		/* wasm32: keep the whole output below the 1 GiB bridge cap. */
		if (json_len > 0 && total <= (size_t)1 << 30) {
			g_result.packed.data = (uint8_t *)malloc(total + 4);
			if (g_result.packed.data) {
				memcpy(g_result.packed.data, &json_len, 4);
				memcpy(g_result.packed.data + 4, g_result.json.data, g_result.json.size);
				memcpy(g_result.packed.data + 4 + g_result.json.size,
					g_result.bin.data, g_result.bin.size);
				g_result.packed.size = total + 4;
			}
		}
		free(g_result.json.data);
		free(g_result.bin.data);
		g_result.json.data = NULL;
		g_result.json.size = 0;
		g_result.json.cap = 0;
		g_result.bin.data = NULL;
		g_result.bin.size = 0;
		g_result.bin.cap = 0;
		if (!g_result.packed.data) {
			snprintf(g_error, sizeof(g_error),
				"{\"ok\":false,\"code\":\"oom\",\"message\":\"out of memory packing result\"}");
			g_error_used = 1;
			ufbx_free_scene(scene);
			return -1;
		}
	}

	ufbx_free_scene(scene);
	return 0;
}

const char *serpent_error(void)
{
	return g_error_used ? g_error : "{\"ok\":false,\"code\":\"internal\",\"message\":\"no error recorded\"}";
}

uint8_t *serpent_out_ptr(void)
{
	return g_result.packed.data;
}

size_t serpent_out_size(void)
{
	return g_result.packed.size;
}

void serpent_free_out(void)
{
	free(g_result.json.data);
	free(g_result.bin.data);
	free(g_result.packed.data);
	memset(&g_result, 0, sizeof(g_result));
}
