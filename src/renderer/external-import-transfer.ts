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
