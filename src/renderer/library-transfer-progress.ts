export type LibraryTransferKind = "import" | "open" | "open-eagle" | "open-billfish";

export function libraryTransferKindFromOperation(
  operation: string | undefined,
): LibraryTransferKind {
  if (operation === "open-eagle") return "open-eagle";
  if (operation === "open-billfish") return "open-billfish";
  if (operation === "open" || operation === "create") return "open";
  return "import";
}

export function isLibraryOpenTransferKind(kind: LibraryTransferKind): boolean {
  return kind === "open" || kind === "open-eagle" || kind === "open-billfish";
}

export function libraryTransferHeadlineKey(kind: LibraryTransferKind): {
  key:
    | "progress.validatingEagleLibrary"
    | "progress.validatingBillfishLibrary"
    | "progress.openingLibrary"
    | "progress.importingLibrary";
  name?: boolean;
} {
  if (kind === "open-eagle") {
    return { key: "progress.validatingEagleLibrary" };
  }
  if (kind === "open-billfish") {
    return { key: "progress.validatingBillfishLibrary" };
  }
  if (kind === "open") {
    return { key: "progress.openingLibrary", name: true };
  }
  return { key: "progress.importingLibrary" };
}
