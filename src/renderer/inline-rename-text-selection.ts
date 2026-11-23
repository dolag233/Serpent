import type { MouseEvent } from "react";

export function beginInlineRenameTextSelection(event: MouseEvent<HTMLInputElement>): void {
  event.stopPropagation();
  if (event.button !== 0 || event.shiftKey) return;
  const input = event.currentTarget;
  const start = input.selectionStart;
  // A primary press within the F2 selection would otherwise drag the old
  // selection. Let the browser place the caret and start a fresh selection.
  if (start !== null && start !== input.selectionEnd) {
    input.setSelectionRange(start, start);
  }
}
