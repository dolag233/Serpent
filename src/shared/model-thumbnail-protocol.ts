/**
 * Offscreen model-thumbnail render protocol (slice E, Serpent-hnmg).
 *
 * Role split (per the process architecture invariant): the Library Worker is
 * the queue/state owner (job claim, thumbnailStatus, artifact storage) but has
 * no WebGL; Main owns the shared offscreen BrowserWindow that renders model
 * frames. This module is the wire contract between them, mirroring the
 * plugin-media-provider request/response pattern:
 *
 *   Worker ──postMessage──▶ { type: 'model-thumbnail.render-request', ... }
 *   Main   ──postMessage──▶ { type: 'model-thumbnail.render-response', ... }
 *
 * The render request carries everything the offscreen page needs to load and
 * frame the model without any path or SQL capability: the model URL
 * (serpent://source for source formats, serpent://preview for the FBX→GLB
 * conversion product), the companion texture index (relative path → assetId)
 * and the HDRI preset id. Bytes return to the Worker, which alone persists
 * the artifact row.
 */

import { z } from 'zod';

/** Model formats the offscreen page can load (mirror of 3d-viewer ModelFormat). */
export const MODEL_THUMBNAIL_FORMATS = ['glb', 'gltf', 'fbx', 'obj', 'stl'] as const;
export type ModelThumbnailFormat = (typeof MODEL_THUMBNAIL_FORMATS)[number];

/** Format dispatch from a model file name; mirrors loader-registry, kept local to avoid a three dependency in the Worker. */
export function modelThumbnailFormatForFileName(fileName: string): ModelThumbnailFormat | null {
  const match = /\.([a-z0-9]+)$/iu.exec(fileName);
  if (!match) return null;
  switch (match[1]!.toLowerCase()) {
    case 'glb': return 'glb';
    case 'gltf': return 'gltf';
    case 'fbx': return 'fbx';
    case 'obj': return 'obj';
    case 'stl': return 'stl';
    default: return null;
  }
}

/** Fixed render size (square, long edge); DPR is forced to 1 by the page. */
export const MODEL_THUMBNAIL_DEFAULT_EDGE = 512;
/** generator_version tag for model thumbnail artifacts (cache/invalidation key). */
export const MODEL_THUMBNAIL_GENERATOR_VERSION = 'offscreen-webgl-1';

/** Typed render failure codes (see also benign suppression in thumbnail-support.ts). */
export const modelThumbnailErrorCodeSchema = z.enum([
  'MODEL_LOAD_FAILED', // model parse/load error inside the offscreen page
  'MODEL_WEBGL_UNAVAILABLE', // WebGLRenderer creation failed
  'MODEL_CONTEXT_LOST', // GPU context lost mid-render
  'MODEL_EMPTY_SCENE', // loaded model has no geometry
  'MODEL_BLANK_FRAME', // frame pixels are uniform (driver/readback issue)
  'MODEL_FRAME_INVALID', // frame bytes failed validation
  'MODEL_WINDOW_FAILED', // offscreen window creation/load/crash
  'MODEL_RENDER_ABORTED', // renderer disposed or window torn down
]);
export type ModelThumbnailErrorCode = z.infer<typeof modelThumbnailErrorCodeSchema>;

export const modelThumbnailCompanionSchema = z.object({
  /**
   * Library-relative POSIX path of the companion asset (worker payload, no abs
   * paths). Reject traversal/absolute segments as defense in depth — the
   * Worker's companion resolver is the primary guard; this keeps a malformed
   * request from ever reaching the page's texture-map keys.
   */
  relativeFilePath: z
    .string()
    .min(1)
    .max(1024)
    .refine(
      (value) => !value.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(value) && !value.split('/').includes('..'),
      { message: 'companion path must stay library-relative' },
    ),
  assetId: z.string().min(1).max(255),
  /** Current revision token — the source route validates it when serving. */
  revisionId: z.string().min(1).max(255),
  extension: z.string().min(1).max(16),
});
export type ModelThumbnailCompanion = z.infer<typeof modelThumbnailCompanionSchema>;

export const modelThumbnailRenderRequestSchema = z.object({
  type: z.literal('model-thumbnail.render-request'),
  requestId: z.string().min(1).max(255),
  libraryId: z.string().min(1).max(255),
  assetId: z.string().min(1).max(255),
  revisionId: z.string().min(1).max(255),
  /** glb/gltf/obj/stl load their source URL; fbx arrives pre-converted as 'glb'. */
  format: z.enum(MODEL_THUMBNAIL_FORMATS),
  /** serpent://source/...?revision= or serpent://preview/<libraryId>/<artifactId>. */
  renderUrl: z.string().min(1).max(4096),
  companionMap: z.array(modelThumbnailCompanionSchema).max(5000),
  hdriPresetId: z.string().min(1).max(128),
  width: z.number().int().min(64).max(2048),
  height: z.number().int().min(64).max(2048),
  /** Optional camera directions for multi-view renders (e.g. AI four views). */
  views: z.array(z.tuple([z.number(), z.number(), z.number()])).min(1).max(8).optional(),
});
export type ModelThumbnailRenderRequest = z.infer<typeof modelThumbnailRenderRequestSchema>;

/**
 * Main-only authorization scope for source requests made during an offscreen
 * render. The Worker resolves these paths before asking Main to render so the
 * renderer never re-enters the Worker through `serpent://source` while the
 * thumbnail job is awaiting the frame.
 */
export const modelThumbnailSourceAuthorizationSchema = z.object({
  libraryId: z.string().min(1).max(255),
  assetId: z.string().min(1).max(255),
  revisionId: z.string().min(1).max(255),
  absolutePath: z.string().min(1).max(4096),
  mimeType: z.string().min(1).max(255),
});
export type ModelThumbnailSourceAuthorization = z.infer<
  typeof modelThumbnailSourceAuthorizationSchema
>;

/** Worker → Main envelope; Main strips `sourceAuthorizations` before IPC to the page. */
export const modelThumbnailMainRenderRequestSchema = modelThumbnailRenderRequestSchema.extend({
  sourceAuthorizations: z.array(modelThumbnailSourceAuthorizationSchema).max(5000),
});
export type ModelThumbnailMainRenderRequest = z.infer<
  typeof modelThumbnailMainRenderRequestSchema
>;

export function parseModelThumbnailMainRenderRequest(
  input: unknown,
): ModelThumbnailMainRenderRequest {
  return modelThumbnailMainRenderRequestSchema.parse(input);
}

export function parseModelThumbnailRenderRequest(input: unknown): ModelThumbnailRenderRequest {
  return modelThumbnailRenderRequestSchema.parse(input);
}

export const modelThumbnailRenderResultSchema = z.union([
  z.object({
    status: z.literal('ok'),
    pngBytes: z.instanceof(Uint8Array),
    width: z.number().int().min(64).max(2048),
    height: z.number().int().min(64).max(2048),
  }),
  z.object({
    status: z.literal('ok'),
    frames: z.array(z.object({
      view: z.tuple([z.number(), z.number(), z.number()]),
      pngBytes: z.instanceof(Uint8Array),
      width: z.number().int().min(64).max(2048),
      height: z.number().int().min(64).max(2048),
    })).min(1),
  }),
  z.object({
    status: z.literal('failed'),
    errorCode: modelThumbnailErrorCodeSchema,
    reason: z.string().max(512).optional(),
  }),
]);
export type ModelThumbnailRenderResult = z.infer<typeof modelThumbnailRenderResultSchema>;

export const modelThumbnailRenderResponseSchema = z.object({
  type: z.literal('model-thumbnail.render-response'),
  requestId: z.string().min(1).max(255),
  result: modelThumbnailRenderResultSchema,
});
export type ModelThumbnailRenderResponse = z.infer<typeof modelThumbnailRenderResponseSchema>;

export function parseModelThumbnailRenderResponse(input: unknown): ModelThumbnailRenderResponse {
  return modelThumbnailRenderResponseSchema.parse(input);
}

/** Every MODEL_* code is a benign thumbnail outcome (card keeps the generic 3D icon). */
export const MODEL_THUMBNAIL_ERROR_CODES: ReadonlySet<string> = new Set(
  modelThumbnailErrorCodeSchema.options,
);
