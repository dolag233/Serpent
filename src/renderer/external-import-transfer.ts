import { MANAGED_ASSETS_DRAG_TYPE } from "./asset-drag-drop";

export function supportsExternalImportTypes(types: readonly string[]): boolean {
  // Internal asset/folder drags often also expose "Files" on Chromium; treat
  // Serpent-managed payloads as move/copy, never as "import".
  if (types.includes(MANAGED_ASSETS_DRAG_TYPE)) {
    return false;
  }
  return (
    types.includes("Files") ||
    types.includes("text/html") ||
    types.includes("text/uri-list")
  );
}

export function supportsExternalImportTransfer(transfer: DataTransfer): boolean {
  return supportsExternalImportTypes(Array.from(transfer.types));
}

/** Canvas "drop to import" chrome. In-app asset drags are moves, not imports. */
export function shouldActivateExternalImportOverlay(
  types: readonly string[],
  internalAssetDrag: boolean,
): boolean {
  if (internalAssetDrag) return false;
  return supportsExternalImportTypes(types);
}

export type InternalDragPhase = "idle" | "starting" | "active";

/**
 * macOS `startDrag` returns immediately, and cancelling the HTML5 drag fires
 * `dragend` in the same gesture. That early `dragend` must not end the OS
 * drag; a real drop, or `dragend` after the gesture has armed, does.
 */
export function reduceInternalDragPhase(
  phase: InternalDragPhase,
  event: "begin" | "arm" | "drop" | "dragend",
): InternalDragPhase {
  if (event === "begin") return "starting";
  if (event === "arm") return phase === "starting" ? "active" : phase;
  if (event === "drop") return "idle";
  return phase === "active" ? "idle" : phase;
}

export function externalImportPayload(transfer: DataTransfer): {
  files: File[];
  html: string;
  uriList: string;
} {
  // Renderer reads browser-provided drag metadata only. Fetching and staging
  // remain inside Main/Worker and URLs never become filesystem paths.
  const read = (type: string): string => {
    try {
      return transfer.getData(type);
    } catch {
      return "";
    }
  };
  return {
    files: Array.from(transfer.files),
    html: read("text/html"),
    uriList: read("text/uri-list"),
  };
}
