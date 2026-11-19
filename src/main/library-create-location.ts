import { randomUUID } from "node:crypto";

/** Native chooser authority stays in Main; a newer choice replaces the old one. */
let pendingSelection: { token: string; selectedParentPath: string } | undefined;
let pickerPending = false;

export function rememberLibraryCreateLocation(selectedParentPath: string | undefined): string | null {
  pendingSelection = selectedParentPath
    ? { token: randomUUID(), selectedParentPath }
    : undefined;
  return pendingSelection?.token ?? null;
}

export function consumeLibraryCreateLocation(token: string): string | undefined {
  if (pendingSelection?.token !== token) return undefined;
  const { selectedParentPath } = pendingSelection;
  pendingSelection = undefined;
  return selectedParentPath;
}

export async function chooseLibraryCreateLocation(
  pick: () => Promise<string | undefined>,
): Promise<string | null> {
  if (pickerPending) return null;
  pickerPending = true;
  rememberLibraryCreateLocation(undefined);
  try {
    return rememberLibraryCreateLocation(await pick());
  } finally {
    pickerPending = false;
  }
}
