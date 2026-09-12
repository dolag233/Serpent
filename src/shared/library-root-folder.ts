/**
 * Serpent-316493 follow-up: the folder panel's blank area is the library root,
 * so its context menu acts on the root folder.
 *
 * The root has no managed_folders row, so callers that need a folder id for it
 * pass this sentinel. It is deliberately not a UUID and not the renderer-only
 * browse scope string "root": the value crosses the Renderer → Main → Worker
 * boundary in `folder.get-path`, where it must never be confused with a real
 * folder id.
 */
export const LIBRARY_ROOT_FOLDER_ID = "serpent:library-root";

export function isLibraryRootFolderId(folderId: string | null | undefined): boolean {
  return folderId === LIBRARY_ROOT_FOLDER_ID;
}
