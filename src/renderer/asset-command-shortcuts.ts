export type AssetCommand = "open-external" | "move-to-trash";

export type KeyboardShortcutEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export function isMacPlatform(userAgent: string): boolean {
  return userAgent.includes("Mac") && !userAgent.includes("Mobile");
}

export function assetCommandShortcut(
  command: AssetCommand,
  mac: boolean,
): string {
  if (command === "open-external") return mac ? "⌘O" : "Ctrl+O";
  return mac ? "⌘⌫" : "Delete";
}

export function matchesAssetCommandShortcut(
  event: KeyboardShortcutEvent,
  command: AssetCommand,
  mac: boolean,
): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (command === "open-external") {
    const expectedModifier = mac ? event.metaKey : event.ctrlKey;
    const unexpectedModifier = mac ? event.ctrlKey : event.metaKey;
    return expectedModifier && !unexpectedModifier && event.key.toLowerCase() === "o";
  }
  if (mac) {
    return event.metaKey && !event.ctrlKey && event.key === "Backspace";
  }
  return !event.metaKey && !event.ctrlKey && event.key === "Delete";
}
