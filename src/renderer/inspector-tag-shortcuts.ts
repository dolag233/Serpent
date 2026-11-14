import { useEffect, type RefObject } from "react";
import { matchesRuntimeShortcut } from "./shortcut-runtime";
import { hasActiveModalDialog } from "./use-dialog-focus-trap";

const COMMAND_EVENT = "serpent:tag-clipboard";
type TagClipboardCommand = "copy" | "paste";

export function inspectorTagShortcutScope(target: Element | null): HTMLElement | null {
  if (target?.closest("input, textarea, select, [contenteditable='true']")) return null;
  return target?.closest<HTMLElement>(".inspector-tags-section") ?? null;
}

/** Native menu accelerators share the same focused tag scope as DOM keys. */
export function dispatchFocusedTagClipboardCommand(command: TagClipboardCommand): boolean {
  if (hasActiveModalDialog()) return false;
  const scope = inspectorTagShortcutScope(document.activeElement);
  return scope ? !scope.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: command, cancelable: true })) : false;
}

export function useInspectorTagShortcuts(
  ref: RefObject<HTMLElement | null>,
  copy: () => void,
  paste: () => void,
) {
  useEffect(() => {
    const scope = ref.current;
    if (!scope) return;
    const execute = (command: TagClipboardCommand) => { if (command === "copy") copy(); else paste(); };
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<TagClipboardCommand>).detail;
      if (command !== "copy" && command !== "paste") return;
      event.preventDefault();
      execute(command);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || hasActiveModalDialog() || !inspectorTagShortcutScope(event.target as Element)) return;
      const command = matchesRuntimeShortcut("asset.copy", event) ? "copy"
        : matchesRuntimeShortcut("asset.paste", event) ? "paste" : null;
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      execute(command);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!inspectorTagShortcutScope(event.target as Element) || hasActiveModalDialog()) return;
      event.preventDefault();
      event.stopPropagation();
      paste();
    };
    scope.addEventListener(COMMAND_EVENT, onCommand);
    scope.addEventListener("keydown", onKeyDown);
    scope.addEventListener("paste", onPaste);
    return () => {
      scope.removeEventListener(COMMAND_EVENT, onCommand);
      scope.removeEventListener("keydown", onKeyDown);
      scope.removeEventListener("paste", onPaste);
    };
  }, [ref, copy, paste]);
}
