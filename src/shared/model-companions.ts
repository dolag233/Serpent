/**
 * Companion-texture index contract for model previews (slice C, Serpent-qvc6).
 *
 * The Worker (`model.resolve-companions` command) returns the assets in the
 * model's directory as relative-path entries; the renderer 3D loaders rewrite
 * OBJ+MTL / FBX / glTF external texture references against this index to
 * `serpent://source/<libraryId>/<assetId>?revision=<revisionId>` URLs (the
 * `preview` host serves artifacts, not assets — E2E caught the assetId-in-
 * preview-host 404). Only library-relative POSIX paths and ids cross the
 * boundary — no absolute paths (REQ-COMMAND-003).
 */
export interface ModelCompanionAsset {
  /** Library-relative POSIX path (e.g. `props/robot/textures/albedo.png`). */
  relativeFilePath: string;
  assetId: string;
  /** Current revision token of the companion asset (source-URL auth). */
  revisionId: string;
  /** Lowercased extension including the dot (`.png`). */
  extension: string;
}
