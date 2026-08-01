import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { createDesktopBrowseControl } from '../../src/main/desktop-browse-control';
import {
  EMPTY_DESKTOP_DISCOVERY_FILTERS,
  type DesktopBrowseState,
} from '../../src/shared/desktop-control';

const state: DesktopBrowseState = {
  libraryId: 'library-1',
  browseTarget: 'root',
  folderId: null,
  organizationId: null,
  showTrash: false,
  includeSubfolders: false,
  search: '',
  colorFilter: '',
  excludeColorFilter: false,
  ...EMPTY_DESKTOP_DISCOVERY_FILTERS,
  sortField: 'name',
  sortOrder: 'asc',
  viewMode: 'grid',
  selectedAssetIds: [],
  primaryAssetId: null,
  viewerAssetId: null,
};

function webContents() {
  return {
    isDestroyed: () => false,
    send: vi.fn(),
  } as unknown as WebContents;
}

describe('DesktopBrowseControl', () => {
  it('round-trips a state request through the authorized renderer', async () => {
    const sender = webContents();
    const control = createDesktopBrowseControl({
      getWebContents: () => sender,
    });
    const request = control.getState('library-1');
    const payload = (sender.send as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      requestId: string;
    };

    control.handleResult(sender, {
      type: 'state',
      requestId: payload.requestId,
      ok: true,
      state,
    });

    await expect(request).resolves.toEqual(state);
    expect(sender.send).toHaveBeenCalledWith(
      'serpent:desktop-automation:browse',
      expect.objectContaining({
        type: 'get-state',
        libraryId: 'library-1',
      }),
    );
  });

  it('sends semantic folder intent and surfaces typed renderer failures', async () => {
    const sender = webContents();
    const control = createDesktopBrowseControl({
      getWebContents: () => sender,
    });
    const request = control.openFolder('library-1', 'folder-1');
    const payload = (sender.send as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      requestId: string;
    };
    expect(sender.send).toHaveBeenCalledWith(
      'serpent:desktop-automation:browse',
      expect.objectContaining({
        type: 'open-folder',
        libraryId: 'library-1',
        folderId: 'folder-1',
      }),
    );

    control.handleResult(sender, {
      type: 'failure',
      requestId: payload.requestId,
      ok: false,
      code: 'DESKTOP_BROWSE_FOLDER_NOT_FOUND',
      message: 'The requested managed folder was not found.',
    });

    await expect(request).rejects.toThrow('DESKTOP_BROWSE_FOLDER_NOT_FOUND');
  });

  it('round-trips viewer open and close intents through the authorized renderer', async () => {
    const sender = webContents();
    const control = createDesktopBrowseControl({
      getWebContents: () => sender,
    });
    const openRequest = control.openViewer('library-1', 'asset-1');
    const openPayload = (sender.send as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      requestId: string;
    };
    control.handleResult(sender, {
      type: 'viewer-updated',
      requestId: openPayload.requestId,
      ok: true,
      state: { ...state, viewerAssetId: 'asset-1' },
    });
    await expect(openRequest).resolves.toMatchObject({
      viewerAssetId: 'asset-1',
    });

    const closeRequest = control.closeViewer('library-1');
    const closePayload = (sender.send as ReturnType<typeof vi.fn>).mock.calls[1]![1] as {
      requestId: string;
    };
    control.handleResult(sender, {
      type: 'viewer-updated',
      requestId: closePayload.requestId,
      ok: true,
      state,
    });
    await expect(closeRequest).resolves.toEqual(state);
  });

  it('round-trips viewer navigate intents through the authorized renderer', async () => {
    const sender = webContents();
    const control = createDesktopBrowseControl({
      getWebContents: () => sender,
    });
    const request = control.navigateViewer('library-1', 'next');
    const payload = (sender.send as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      requestId: string;
    };
    expect(sender.send).toHaveBeenCalledWith(
      'serpent:desktop-automation:browse',
      expect.objectContaining({
        type: 'navigate-viewer',
        libraryId: 'library-1',
        direction: 'next',
      }),
    );
    control.handleResult(sender, {
      type: 'viewer-updated',
      requestId: payload.requestId,
      ok: true,
      state: { ...state, viewerAssetId: 'asset-2' },
    });
    await expect(request).resolves.toMatchObject({
      viewerAssetId: 'asset-2',
    });
  });
});
