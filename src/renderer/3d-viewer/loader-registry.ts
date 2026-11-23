/**
 * Model loader registry (spec §7 slice C / 3D-11 / 3D-12).
 *
 * Dispatches model files by extension to the matching three loader and wires
 * every external reference through the companion texture map
 * (`model.resolve-companions`, see url-remap.ts):
 *
 * - `.glb`              → GLTFLoader with embedded textures;
 * - `.gltf`             → GLTFLoader with companion image and buffer URLs;
 * - `.fbx`              → FBXLoader on the source revision, with companion
 *                         texture remapping and Phong→Standard materials;
 * - `.obj`              → MTL text fetched through the companion map and
 *                         rewritten (map_* refs), parsed by MTLLoader; meshes
 *                         upgraded Phong→Standard;
 * - `.stl`              → STLLoader + theme default material (stlDefaultMaterial).
 *
 * Loaders and `fetch` are injectable for tests; the module itself is
 * framework-free (no React, no WebGL).
 */

import {
  Group,
  LoadingManager,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  TextureLoader,
} from 'three';
import type { AnimationClip, Texture } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { TIFFLoader } from 'three/addons/loaders/TIFFLoader.js';

import type { ModelCompanionAsset } from '../../shared/model-companions';
import { applyBaseColorTextureAlpha } from './base-color-alpha';
import { MATERIAL_TEXTURE_SLOTS } from './model-stats';
import {
  mapPhongToStandard,
  stlDefaultMaterial,
  type StandardMaterialParams,
} from './pbr-mapping';
import {
  collectObjMtllibRefs,
  remapCompanionUrl,
  remapCompanionUrlByBasename,
  rewriteGltfUris,
  rewriteMtlTextureRefs,
  type GltfJsonLike,
} from './url-remap';

export type ModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj' | 'stl';

/** Extension → loader dispatch (lowercased, no leading dot). */
export function modelFormatForExtension(fileName: string): ModelFormat | null {
  const match = /\.([a-z0-9]+)$/iu.exec(fileName);
  if (!match) return null;
  switch (match[1]!.toLowerCase()) {
    case 'glb':
      return 'glb';
    case 'gltf':
      return 'gltf';
    case 'fbx':
      return 'fbx';
    case 'obj':
      return 'obj';
    case 'stl':
      return 'stl';
    default:
      return null;
  }
}

export interface LoadedModelScene {
  readonly scene: Group;
  /** AnimationClips for slice F (AnimationMixer); empty for static formats. */
  readonly animations: AnimationClip[];
  readonly missingTextures: readonly string[];
}

export interface ModelLoaderDeps {
  gltf?: GLTFLoader;
  fbx?: FBXLoader;
  obj?: OBJLoader;
  mtl?: MTLLoader;
  stl?: STLLoader;
  textureLoader?: TextureLoader;
  /** Text fetcher (defaults to global fetch); injectable for tests. */
  fetchText?: (url: string) => Promise<string>;
}

export interface LoadModelSceneInput {
  readonly format: ModelFormat;
  /** `serpent://source/...` URL of the model asset. */
  readonly sourceUrl: string;
  readonly libraryId: string;
  /** Companion index from `model.resolve-companions`. */
  readonly companionMap: ReadonlyMap<string, ModelCompanionAsset>;
  /** STL default material params (theme-aware); defaults to the neutral value. */
  readonly stlMaterial?: StandardMaterialParams;
  readonly deps?: ModelLoaderDeps;
}

export async function loadModelScene(
  input: LoadModelSceneInput,
): Promise<LoadedModelScene> {
  switch (input.format) {
    case 'glb':
      return loadGlb(input);
    case 'gltf':
      return loadGltfText(input);
    case 'fbx':
      return loadFbx(input);
    case 'obj':
      return loadObj(input);
    case 'stl':
      return loadStl(input);
  }
}

function remapRelative(input: LoadModelSceneInput) {
  return (relativePath: string): string | null =>
    remapCompanionUrl({
      relativePath,
      libraryId: input.libraryId,
      companionMap: input.companionMap,
    });
}

async function loadGlb(input: LoadModelSceneInput): Promise<LoadedModelScene> {
  const loader = input.deps?.gltf ?? new GLTFLoader();
  const gltf = await loader.loadAsync(input.sourceUrl);
  const scene = gltf.scene ?? new Group();
  enableShadowCasting(scene);
  return { scene, animations: gltf.animations ?? [], missingTextures: [] };
}

async function loadGltfText(input: LoadModelSceneInput): Promise<LoadedModelScene> {
  const loader = input.deps?.gltf ?? new GLTFLoader();
  const text = await fetchText(input.sourceUrl, input.deps?.fetchText);
  const json = JSON.parse(text) as GltfJsonLike;
  const rewritten = rewriteGltfUris(json, remapRelative(input));
  const gltf = await new Promise<{ scene?: Group; animations?: AnimationClip[] }>(
    (resolve, reject) => {
      loader.parse(JSON.stringify(rewritten), '', resolve, reject);
    },
  );
  const scene = gltf.scene ?? new Group();
  enableShadowCasting(scene);
  return { scene, animations: gltf.animations ?? [], missingTextures: [] };
}

async function loadFbx(input: LoadModelSceneInput): Promise<LoadedModelScene> {
  const missingTextures = new Set<string>();
  const root = input.deps?.fbx
    ? await input.deps.fbx.loadAsync(input.sourceUrl)
    : await loadFbxWithTextures(input, missingTextures);
  const animations =
    (root as Group & { animations?: AnimationClip[] }).animations ?? [];
  upgradeSourceMaterials(root);
  applyBaseColorTextureAlpha(root);
  enableShadowCasting(root);
  return {
    scene: root,
    animations,
    missingTextures: [...missingTextures],
  };
}

async function loadFbxWithTextures(
  input: LoadModelSceneInput,
  missingTextures: Set<string>,
): Promise<Group> {
  const resourcePath = 'serpent-fbx-texture:/';
  const manager = new LoadingManager();
  const embeddedUrls = new Set<string>();
  manager.addHandler(/\.tga$/iu, new TGALoader(manager));
  manager.addHandler(/\.tiff?$/iu, new TIFFLoader(manager));
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') && url !== input.sourceUrl) embeddedUrls.add(url);
    if (!url.startsWith(resourcePath)) return url;
    const fileName = url.slice(resourcePath.length);
    const companionUrl = remapCompanionUrlByBasename({
      fileName,
      libraryId: input.libraryId,
      companionMap: input.companionMap,
    });
    if (companionUrl) return companionUrl;
    missingTextures.add(fileName);
    return url;
  });
  // FBXLoader resolves when geometry is parsed, while its images can still
  // be loading. Include those loads before capturing an offscreen frame.
  const settled = new Promise<void>((resolve) => { manager.onLoad = resolve; });
  const loader = new FBXLoader(manager).setResourcePath(resourcePath);
  // FileLoader can share an in-flight URL without registering it on this
  // manager. Track our own load so onLoad also fires for a shared fetch.
  manager.itemStart(input.sourceUrl);
  try {
    let root: Group;
    try {
      root = await loader.loadAsync(input.sourceUrl);
    } finally {
      manager.itemEnd(input.sourceUrl);
    }
    await settled;
    return root;
  } finally {
    for (const url of embeddedUrls) URL.revokeObjectURL(url);
  }
}

async function loadObj(input: LoadModelSceneInput): Promise<LoadedModelScene> {
  const objLoader = input.deps?.obj ?? new OBJLoader();
  const mtlLoader = input.deps?.mtl ?? new MTLLoader();
  const objText = await fetchText(input.sourceUrl, input.deps?.fetchText);

  const mtllibs = collectObjMtllibRefs(objText);
  const lastMtllib = mtllibs.length > 0 ? mtllibs[mtllibs.length - 1]! : null;
  if (lastMtllib) {
    const mtlUrl = remapRelative(input)(lastMtllib);
    if (mtlUrl) {
      try {
        const mtlText = await fetchText(mtlUrl, input.deps?.fetchText);
        const rewritten = rewriteMtlTextureRefs(mtlText, remapRelative(input));
        objLoader.setMaterials(mtlLoader.parse(rewritten, ''));
      } catch {
        // MTL unreadable → materials fall back to the neutral defaults below
        // (3D-12: 解析不到时材质降级并提示).
      }
    }
  }

  const root = objLoader.parse(objText);
  upgradeSourceMaterials(root, input);
  enableShadowCasting(root);
  return { scene: root, animations: [], missingTextures: [] };
}

async function loadStl(input: LoadModelSceneInput): Promise<LoadedModelScene> {
  const loader = input.deps?.stl ?? new STLLoader();
  const geometry = await loader.loadAsync(input.sourceUrl);
  // STL carries no normals; averaged vertex normals give the smooth preview
  // look DAM viewers expect (research §4.1).
  geometry.computeVertexNormals();
  const material = new MeshStandardMaterial(
    input.stlMaterial ?? stlDefaultMaterial('dark'),
  );
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const scene = new Group();
  scene.add(mesh);
  return { scene, animations: [], missingTextures: [] };
}

async function fetchText(
  url: string,
  injected?: (url: string) => Promise<string>,
): Promise<string> {
  if (injected) return injected(url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status}): ${url}`);
  }
  return response.text();
}

/** Ground shadows need casters: every mesh must castShadow (3D-07). */
function enableShadowCasting(root: Group): void {
  root.traverse((object) => {
    if (object instanceof Mesh) object.castShadow = true;
  });
}

/**
 * Upgrade source-loader Phong/Lambert materials to MeshStandardMaterial.
 *
 * Shared materials are upgraded once; mesh material references (single or
 * array) are replaced afterwards.
 */
function upgradeSourceMaterials(root: Group, remapInput?: LoadModelSceneInput): void {
  const textureLoader = remapInput && (remapInput.deps?.textureLoader ?? new TextureLoader());
  const upgraded = new Map<object, MeshStandardMaterial>();

  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material = object.material;
    const materials = Array.isArray(material) ? material : [material];
    const replacements: Array<MeshStandardMaterial | MeshPhongMaterial | MeshLambertMaterial> = [];
    for (const current of materials) {
      if (!(current instanceof MeshPhongMaterial) && !(current instanceof MeshLambertMaterial)) {
        // Already standard (or a special material) — leave untouched.
        replacements.push(current);
        continue;
      }
      let standard = upgraded.get(current);
      if (!standard) {
        if (remapInput && textureLoader) remapFallbackTextureSlots(current, remapInput, textureLoader);
        standard = toStandardMaterial(current);
        upgraded.set(current, standard);
      }
      replacements.push(standard);
    }
    object.material = replacements.length === 1 ? replacements[0]! : replacements;
  });
}

function remapFallbackTextureSlots(
  material: MeshPhongMaterial | MeshLambertMaterial,
  input: LoadModelSceneInput,
  textureLoader: TextureLoader,
): void {
  for (const slot of MATERIAL_TEXTURE_SLOTS) {
    const texture = (material as unknown as Record<string, unknown>)[slot];
    if (!texture || typeof texture !== 'object') continue;
    const candidate = texture as Texture & { name?: unknown };
    // Already-decoded textures (MTL path) keep their URL; only failed loads
    // (FBX fallback against the flat source URL) are re-pointed.
    if (textureHasDecodedImage(candidate)) continue;
    if (typeof candidate.name !== 'string' || candidate.name.length === 0) continue;
    const url = remapCompanionUrlByBasename({
      fileName: candidate.name,
      libraryId: input.libraryId,
      companionMap: input.companionMap,
    });
    if (!url) continue;
    const replacement = textureLoader.load(url);
    replacement.name = candidate.name;
    (material as unknown as Record<string, unknown>)[slot] = replacement;
  }
}

function textureHasDecodedImage(texture: Texture): boolean {
  const image = texture.image as
    | {
        naturalWidth?: number;
        naturalHeight?: number;
        width?: number;
        height?: number;
      }
    | null
    | undefined;
  if (!image) return false;
  return (
    (image.naturalWidth ?? 0) > 0 ||
    (image.naturalHeight ?? 0) > 0 ||
    (image.width ?? 0) > 0 ||
    (image.height ?? 0) > 0
  );
}

function toStandardMaterial(
  material: MeshPhongMaterial | MeshLambertMaterial,
): MeshStandardMaterial {
  const standard = new MeshStandardMaterial(
    mapPhongToStandard({
      color: material.color,
      map: material.map,
      specularMap: 'specularMap' in material ? material.specularMap : null,
      bumpMap: material.bumpMap,
      normalMap: material.normalMap,
      alphaMap: material.alphaMap,
      transparent: material.transparent,
      opacity: material.opacity,
      emissive: material.emissive,
      emissiveMap: material.emissiveMap,
    }),
  );
  standard.name = material.name;
  return standard;
}
