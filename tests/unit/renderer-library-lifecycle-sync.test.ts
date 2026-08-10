import { describe, expect, it } from 'vitest';

import { shouldApplyLibraryLifecycleEvent } from '../../src/renderer/library-lifecycle-sync';
import type { RendererLifecycleEvent } from '../../src/shared/protocol/responses';

const opened = (
  libraryId: string,
  source?: 'mcp',
): RendererLifecycleEvent => ({
  type: 'library.opened',
  library: {
    libraryId,
    displayName: libraryId,
    displayPath: `/libraries/${libraryId}`,
  },
  ...(source === undefined ? {} : { source }),
});

describe('renderer library lifecycle synchronization', () => {
  it('applies an MCP library switch even when another library is already visible', () => {
    expect(shouldApplyLibraryLifecycleEvent({
      event: opened('meme-library', 'mcp'),
      currentLibraryId: 'reference-library',
      scriptSandboxPreviewOpen: false,
    })).toBe(true);
  });

  it('does not duplicate ordinary renderer open responses', () => {
    expect(shouldApplyLibraryLifecycleEvent({
      event: opened('meme-library'),
      currentLibraryId: 'reference-library',
      scriptSandboxPreviewOpen: false,
    })).toBe(false);
    expect(shouldApplyLibraryLifecycleEvent({
      event: opened('meme-library'),
      currentLibraryId: undefined,
      scriptSandboxPreviewOpen: true,
    })).toBe(true);
  });

  it('ignores an already visible library', () => {
    expect(shouldApplyLibraryLifecycleEvent({
      event: opened('reference-library', 'mcp'),
      currentLibraryId: 'reference-library',
      scriptSandboxPreviewOpen: false,
    })).toBe(false);
  });
});
