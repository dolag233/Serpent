# FBX test fixtures

| File | Source | License | Purpose |
|---|---|---|---|
| `blender_272_cube_7400_binary.fbx` | ufbx test data (v0.23.0), <https://github.com/bqqbarbhg/ufbx/blob/v0.23.0/data/blender_272_cube_7400_binary.fbx> | MIT (ufbx repository) | Real Blender 2.72 binary export: 24 corners / 12 triangles, no material |
| `blender_282_suzanne_7400_binary.fbx` | ufbx test data (v0.23.0), <https://github.com/bqqbarbhg/ufbx/blob/v0.23.0/data/blender_282_suzanne_7400_binary.fbx> | MIT (ufbx repository) | Real Blender 2.82 binary export: 968 triangles |
| `ascii-fbx.ts` | hand-written by Serpent (see builder) | MIT (Serpent) | FBX 7.4 ASCII: triangle + quad, normals/UVs, Lambert material, embedded/external PNG texture, configurable axis/unit/transform |

SHA-256 (for fixture integrity):
- `blender_272_cube_7400_binary.fbx` — recompute with `sha256sum` if needed; pinned at ufbx v0.23.0.
- `blender_282_suzanne_7400_binary.fbx` — pinned at ufbx v0.23.0.

The ufbx repository is MIT licensed; its `data/` directory contains test scenes
generated with Blender (see ufbx LICENSE).
