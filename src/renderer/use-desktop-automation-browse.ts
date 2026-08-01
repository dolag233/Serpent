import { useEffect } from 'react';

import type {
  DesktopBrowseAction,
  DesktopBrowseResult,
  DesktopBrowseState,
} from '../shared/desktop-control';
import type { SerpentShellApi } from '../shared/external-url';

export type UseDesktopAutomationBrowseOptions = {
  shellApi: Pick<
    SerpentShellApi,
    'onDesktopAutomationBrowse' | 'respondDesktopAutomationBrowse'
  > | null | undefined;
  state: DesktopBrowseState | null;
  folderIds: readonly string[];
  chooseFolder: (scope: 'root' | string) => Promise<void>;
  setDiscovery: (
    input: Omit<
      Extract<DesktopBrowseAction, { type: 'set-discovery' }>,
      'type' | 'requestId' | 'libraryId'
    >,
  ) => Promise<DesktopBrowseState>;
  revealAsset: (
    assetId: string,
    position: Extract<DesktopBrowseAction, { type: 'reveal-asset' }>['position'],
  ) => Promise<Omit<
    Extract<DesktopBrowseResult, { type: 'reveal-applied' }>,
    'type' | 'requestId' | 'ok'
  >>;
  openViewer: (assetId: string) => Promise<DesktopBrowseState>;
  closeViewer: () => Promise<DesktopBrowseState>;
  navigateViewer: (
    direction: Extract<DesktopBrowseAction, { type: 'navigate-viewer' }>['direction'],
  ) => Promise<DesktopBrowseState>;
  previewOpen: boolean;
};

function failure(
  action: DesktopBrowseAction,
  code: Extract<DesktopBrowseResult, { type: 'failure' }>['code'],
  message: string,
): DesktopBrowseResult {
  return {
    type: 'failure',
    requestId: action.requestId,
    ok: false,
    code,
    message,
  };
}

function discoveryPatchFromAction(
  action: Extract<DesktopBrowseAction, { type: 'set-discovery' }>,
): Omit<Extract<DesktopBrowseAction, { type: 'set-discovery' }>, 'type' | 'requestId' | 'libraryId'> {
  return {
    search: action.search,
    colorFilter: action.colorFilter,
    excludeColorFilter: action.excludeColorFilter,
    includeSubfolders: action.includeSubfolders,
    sortField: action.sortField,
    sortOrder: action.sortOrder,
    formatFilter: action.formatFilter,
    excludeFormatFilter: action.excludeFormatFilter,
    tagFilter: action.tagFilter,
    excludeTagFilter: action.excludeTagFilter,
    tagFilterMatch: action.tagFilterMatch,
    ratingFilter: action.ratingFilter,
    excludeRatingFilter: action.excludeRatingFilter,
    favoriteFilter: action.favoriteFilter,
    sourceUrlFilter: action.sourceUrlFilter,
    availabilityFilter: action.availabilityFilter,
    excludeAvailabilityFilter: action.excludeAvailabilityFilter,
    widthRange: action.widthRange,
    heightRange: action.heightRange,
    aspectRatioRange: action.aspectRatioRange,
    longEdgeRange: action.longEdgeRange,
    durationRange: action.durationRange,
  };
}

/**
 * Main owns the attached session; Renderer owns the real browse state. This
 * hook is the typed intent seam between them and never exposes DOM coordinates
 * or a route implementation.
 */
export function useDesktopAutomationBrowse({
  shellApi,
  state,
  folderIds,
  chooseFolder,
  setDiscovery,
  revealAsset,
  openViewer,
  closeViewer,
  navigateViewer,
  previewOpen,
}: UseDesktopAutomationBrowseOptions): void {
  useEffect(() => {
    if (!shellApi) return;
    const respond = shellApi.respondDesktopAutomationBrowse;
    return shellApi.onDesktopAutomationBrowse((action) => {
      if (state === null || action.libraryId !== state.libraryId) {
        respond(failure(
          action,
          'DESKTOP_BROWSE_LIBRARY_MISMATCH',
          'Desktop browse state belongs to another library.',
        ));
        return;
      }
      if (action.type === 'get-state') {
        respond({
          type: 'state',
          requestId: action.requestId,
          ok: true,
          state,
        });
        return;
      }
      if (action.type === 'set-discovery') {
        if (
          state.browseTarget === 'trash'
          || previewOpen
          || document.querySelector('[role="dialog"][aria-modal="true"]')
        ) {
          respond(failure(
            action,
            'DESKTOP_BROWSE_BLOCKED',
            'Discovery controls are unavailable in the trash.',
          ));
          return;
        }
        void setDiscovery(discoveryPatchFromAction(action))
          .then((nextState) => {
            respond({
              type: 'discovery-updated',
              requestId: action.requestId,
              ok: true,
              state: nextState,
            });
          })
          .catch(() => {
            respond(failure(
              action,
              'DESKTOP_BROWSE_UNAVAILABLE',
              'Desktop discovery controls could not be applied.',
            ));
          });
        return;
      }
      if (action.type === 'reveal-asset') {
        if (
          previewOpen
          || document.querySelector('[role="dialog"][aria-modal="true"]')
        ) {
          respond(failure(
            action,
            'DESKTOP_BROWSE_BLOCKED',
            'Desktop reveal is blocked while another view is open.',
          ));
          return;
        }
        void revealAsset(action.assetId, action.position)
          .then((result) => {
            respond({
              type: 'reveal-applied',
              requestId: action.requestId,
              ok: true,
              ...result,
            });
          })
          .catch(() => {
            respond(failure(
              action,
              'DESKTOP_BROWSE_UNAVAILABLE',
              'Desktop reveal could not be applied.',
            ));
          });
        return;
      }
      if (action.type === 'open-viewer') {
        void openViewer(action.assetId)
          .then((nextState) => {
            respond({
              type: 'viewer-updated',
              requestId: action.requestId,
              ok: true,
              state: nextState,
            });
          })
          .catch(() => {
            respond(failure(
              action,
              'DESKTOP_BROWSE_UNAVAILABLE',
              'Desktop viewer could not be opened.',
            ));
          });
        return;
      }
      if (action.type === 'close-viewer') {
        void closeViewer()
          .then((nextState) => {
            respond({
              type: 'viewer-updated',
              requestId: action.requestId,
              ok: true,
              state: nextState,
            });
          })
          .catch(() => {
            respond(failure(
              action,
              'DESKTOP_BROWSE_UNAVAILABLE',
              'Desktop viewer could not be closed.',
            ));
          });
        return;
      }
      if (action.type === 'navigate-viewer') {
        void navigateViewer(action.direction)
          .then((nextState) => {
            respond({
              type: 'viewer-updated',
              requestId: action.requestId,
              ok: true,
              state: nextState,
            });
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            if (message.startsWith('DESKTOP_BROWSE_VIEWER_CLOSED')) {
              respond(failure(
                action,
                'DESKTOP_BROWSE_VIEWER_CLOSED',
                'Desktop viewer is not open.',
              ));
              return;
            }
            if (message.startsWith('DESKTOP_BROWSE_VIEWER_BOUNDARY')) {
              respond(failure(
                action,
                'DESKTOP_BROWSE_VIEWER_BOUNDARY',
                'Desktop viewer has no neighbor in that direction.',
              ));
              return;
            }
            respond(failure(
              action,
              'DESKTOP_BROWSE_UNAVAILABLE',
              'Desktop viewer could not navigate.',
            ));
          });
        return;
      }
      if (previewOpen || document.querySelector('[role="dialog"][aria-modal="true"]')) {
        respond(failure(
          action,
          'DESKTOP_BROWSE_BLOCKED',
          'Desktop browse is blocked while another view is open.',
        ));
        return;
      }
      if (!['all', 'root', 'folder'].includes(state.browseTarget)) {
        respond(failure(
          action,
          'DESKTOP_BROWSE_BLOCKED',
          'Open folder is unavailable in the current browse scope.',
        ));
        return;
      }
      if (action.folderId !== null && !folderIds.includes(action.folderId)) {
        respond(failure(
          action,
          'DESKTOP_BROWSE_FOLDER_NOT_FOUND',
          'The requested managed folder was not found.',
        ));
        return;
      }
      void chooseFolder(action.folderId ?? 'root')
        .then(() => {
          respond({
            type: 'folder-opened',
            requestId: action.requestId,
            ok: true,
            state: {
              ...state,
              browseTarget: action.folderId === null ? 'root' : 'folder',
              folderId: action.folderId,
              organizationId: null,
            },
          });
        })
        .catch(() => {
          respond(failure(
            action,
            'DESKTOP_BROWSE_UNAVAILABLE',
            'Desktop browse could not open the requested folder.',
          ));
        });
    });
  }, [
    chooseFolder,
    closeViewer,
    folderIds,
    navigateViewer,
    openViewer,
    previewOpen,
    revealAsset,
    setDiscovery,
    shellApi,
    state,
  ]);
}
