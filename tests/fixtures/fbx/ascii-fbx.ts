/**
 * Hand-written FBX 7.4 ASCII fixture builder.
 *
 * Generates a small, fully controlled ASCII FBX (triangle + quad with normals,
 * UVs, a Lambert/Phong material, an embedded or external PNG texture, and a
 * configurable model transform / axis / unit). Used by the FBX conversion
 * tests to assert geometry, material and texture behavior without depending on
 * any DCC exporter.
 */

/** Minimal valid 1×1 red PNG (67 bytes). */
export const ONE_PX_RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export interface AsciiFbxOptions {
  /**
   * Unit scale factor (GlobalSettings UnitScaleFactor). FBX semantics: the
   * factor multiplies centimeters, so 100 = meters (what DCC exporters write
   * for meter scenes), 1 = centimeters.
   */
  unitScaleFactor?: number;
  /** FBX up axis: 0=X, 1=Y, 2=Z (GlobalSettings UpAxis). */
  upAxis?: number;
  /** Model Lcl Translation. */
  translation?: [number, number, number];
  /** Material diffuse color [r, g, b]. */
  diffuseColor?: [number, number, number];
  /** Texture to attach to the material's DiffuseColor map. */
  texture?: {
    /** Embedded content bytes; when set, the texture is embedded. */
    embeddedBytes?: Buffer;
    /** Relative filename referenced by the texture. */
    relativeFilename: string;
  };
  /** Set false to omit geometry (empty scene; used for FBX_NO_MESHES). */
  withMesh?: boolean;
}

/**
 * FBX ASCII stores embedded media as a base64 string with a leading comma
 * (e.g. Blender writes `Content: , "iVBORw0..."`).
 */
function contentNode(name: string, bytes: Buffer): string {
  return `${name}: , "${bytes.toString('base64')}"`;
}

/**
 * Build a valid ASCII FBX 7.4 file: a triangle (0,1,2) and a quad (0,2,3,4)
 * sharing corner 0, per-corner normals/UVs, one material, one texture and one
 * model node. Vertex positions are in the +Z plane by default so the mesh is
 * a flat shape visible from the front.
 */
export function buildAsciiFbx(options: AsciiFbxOptions = {}): Buffer {
  const {
    unitScaleFactor = 100, // meters (FBX: factor × 0.01 m)
    upAxis = 1, // Y-up
    translation = [0, 0, 0],
    diffuseColor = [0.8, 0.2, 0.2],
    texture,
    withMesh = true,
  } = options;

  const positions = [
    0, 0, 0, // corner 0
    1, 0, 0, // corner 1
    0, 1, 0, // corner 2
    1, 1, 0, // corner 3
    2, 0, 0, // corner 4
  ];
  // Two faces: triangle (0,1,2) and quad (0,2,3,4). The negative value marks
  // the last index of a polygon: -N encodes index N-1 and terminates the face.
  // (FBX convention: last index of each polygon is negative.)
  const polygonVertexIndex = [0, 1, -3, 0, 2, 3, -5];
  const normals = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, // triangle corners
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, // quad corners
  ];
  const uvs = [
    0, 0, 1, 0, 0, 1,
    0, 0, 0, 1, 1, 1, 1, 0,
  ];

  const geometry = withMesh
    ? `
	Geometry: 1000, "Geometry::Shape", "Mesh" {
		Vertices: *15 {
			a: ${positions.join(',')}
		}
		PolygonVertexIndex: *8 {
			a: ${polygonVertexIndex.join(',')}
		}
		LayerElementNormal: 0 {
			Version: 101
			Name: ""
			MappingInformationType: "ByPolygonVertex"
			ReferenceInformationType: "Direct"
			Normals: *${normals.length} {
				a: ${normals.join(',')}
			}
		}
		LayerElementUV: 0 {
			Version: 101
			Name: "UVMap"
			MappingInformationType: "ByPolygonVertex"
			ReferenceInformationType: "Direct"
			UV: *${uvs.length} {
				a: ${uvs.join(',')}
			}
		}
		LayerElementMaterial: 0 {
			Version: 101
			Name: ""
			MappingInformationType: "AllSame"
			ReferenceInformationType: "IndexToDirect"
			Materials: *1 {
				a: 0
			}
		}
	}
`
    : '';

  const textureNode = texture
    ? `
	Texture: 3000, "Texture::Tex", "" {
		Type: "TextureVideoClip"
		Version: 202
		TextureName: "Texture::Tex"
		Media: "Video::vid"
		FileName: "${texture.relativeFilename}"
		RelativeFilename: "${texture.relativeFilename}"
		ModelUVTranslation: 0,0
		ModelUVScaling: 1,1
		Texture_Alpha_Source: "None"
		Cropping: 0,0,0,0
	}
	Video: 4000, "Video::vid", "Clip" {
		Type: "Clip"
		Version: 202
		FileName: "${texture.relativeFilename}"
		RelativeFilename: "${texture.relativeFilename}"
		${texture.embeddedBytes ? contentNode('Content', texture.embeddedBytes) : ''}
	}
`
    : '';

  const textureConnection = texture
    ? `
	C: "OP", 3000, 2000, "DiffuseColor"
	C: "OO", 4000, 3000`
    : '';

  const modelConnection = withMesh ? `
	C: "OO", 1000, 5000
	C: "OO", 2000, 5000` : '';

  const [tx, ty, tz] = translation;

  // FBX global axes must be a valid right-handed triple. Y-up files use
  // front=+Z; Z-up files use front=-Y (ufbx convention for Z-up, matching
  // ufbx_axes_right_handed_z_up).
  const frontAxis = upAxis === 2 ? 1 : 2;
  const frontAxisSign = upAxis === 2 ? -1 : 1;

  return Buffer.from(
    `; FBX 7.4.0 project file
FBXHeaderExtension:  {
	FBXHeaderVersion: 1003
	FBXVersion: 7400
	Creator: "Serpent test fixture"
}
GlobalSettings:  {
	Version: 1000
	Properties70:  {
		P: "UpAxis", "int", "Integer", "",${upAxis}
		P: "UpAxisSign", "int", "Integer", "",1
		P: "FrontAxis", "int", "Integer", "",${frontAxis}
		P: "FrontAxisSign", "int", "Integer", "",${frontAxisSign}
		P: "CoordAxis", "int", "Integer", "",0
		P: "CoordAxisSign", "int", "Integer", "",1
		P: "UnitScaleFactor", "double", "Number", "",${unitScaleFactor}
		P: "OriginalUnitScaleFactor", "double", "Number", "",${unitScaleFactor}
	}
}
Definitions:  {
	Version: 100
	Count: 4
	ObjectType: "GlobalSettings" {
		Count: 1
	}
	ObjectType: "Model" {
		Count: 1
	}
	ObjectType: "Geometry" {
		Count: 1
	}
	ObjectType: "Material" {
		Count: 1
	}
	ObjectType: "Texture" {
		Count: 1
	}
	ObjectType: "Video" {
		Count: 1
	}
}
Objects:  {
	${geometry}
	Material: 2000, "Material::Mat", "" {
		Version: 102
		ShadingModel: "phong"
		MultiLayer: 0
		Properties70:  {
			P: "DiffuseColor", "ColorRGB", "Color", "",${diffuseColor[0]},${diffuseColor[1]},${diffuseColor[2]}
			P: "DiffuseFactor", "double", "Number", "",1
			P: "Shininess", "double", "Number", "",20
			P: "ShininessExponent", "double", "Number", "",20
			P: "AmbientColor", "ColorRGB", "Color", "",0,0,0
			P: "SpecularColor", "ColorRGB", "Color", "",0,0,0
		}
	}
	${textureNode}
	Model: 5000, "Model::Shape", "Mesh" {
		Version: 232
		Properties70:  {
			P: "Lcl Translation", "Lcl Translation", "", "A",${tx},${ty},${tz}
			P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
			P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
		}
		Shading: T
		Culling: "CullingOff"
	}
}
Connections:  {
	C: "OO", 5000, 0
	${modelConnection}
	${textureConnection}
}
`,
    'utf8',
  );
}
