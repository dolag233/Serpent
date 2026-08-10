import type { RendererLifecycleEvent } from '../shared/protocol/responses';

export function shouldApplyLibraryLifecycleEvent(input: {
  event: RendererLifecycleEvent;
  currentLibraryId?: string;
  scriptSandboxPreviewOpen: boolean;
}): boolean {
  if (input.event.type !== 'library.opened') return false;
  if (input.event.library.libraryId === input.currentLibraryId) return false;
  return input.event.source === 'mcp'
    || (input.scriptSandboxPreviewOpen && input.currentLibraryId === undefined);
}
