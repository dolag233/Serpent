import { useEffect } from 'react';

import type {
  DesktopControlSelectionEvent,
  DesktopSelectionMode,
} from '../shared/desktop-control';
import type { SerpentShellApi } from '../shared/external-url';

export type DesktopSelectionState = {
  selectedAssetIds: readonly string[];
  primaryAssetId: string | undefined;
};

function uniqueIds(assetIds: readonly string[]): string[] {
  return [...new Set(assetIds)];
}

export function applyDesktopAutomationSelection(
  current: DesktopSelectionState,
  request: Pick<DesktopControlSelectionEvent, 'assetIds' | 'mode'>,
): DesktopSelectionState {
  const requestedIds = uniqueIds(request.assetIds);
  let selectedAssetIds: string[];

  switch (request.mode) {
    case 'replace':
      selectedAssetIds = requestedIds;
      break;
    case 'add':
      selectedAssetIds = uniqueIds([...current.selectedAssetIds, ...requestedIds]);
      break;
    case 'remove':
      selectedAssetIds = current.selectedAssetIds.filter(
        (assetId) => !requestedIds.includes(assetId),
      );
      break;
  }

  const primaryAssetId =
    selectedAssetIds.length === 0
      ? undefined
      : request.mode === 'remove' && selectedAssetIdStillSelected(current.primaryAssetId, selectedAssetIds)
        ? current.primaryAssetId
        : selectedAssetIds.at(-1);

  return { selectedAssetIds, primaryAssetId };
}

function selectedAssetIdStillSelected(
  assetId: string | undefined,
  selectedAssetIds: readonly string[],
): assetId is string {
  return assetId !== undefined && selectedAssetIds.includes(assetId);
}

export type UseDesktopAutomationSelectionOptions = {
  shellApi: Pick<SerpentShellApi, 'onDesktopAutomationSelection'> | null | undefined;
  libraryId: string | null | undefined;
  previewOpen: boolean;
  selectedAssetIds: readonly string[];
  selectedAssetId: string | undefined;
  setSelectedAssetIds: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedAssetId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setAssetSelectionAnchor: (assetId: string | null) => void;
  setSelectedFolderIds?: React.Dispatch<React.SetStateAction<string[]>>;
};

/**
 * Applies explicit, typed selection requests from the attached local Agent.
 * This changes only Renderer selection state; it does not dispatch a Worker
 * command or create an execution/metadata revision.
 */
export function useDesktopAutomationSelection({
  shellApi,
  libraryId,
  previewOpen,
  selectedAssetIds,
  selectedAssetId,
  setSelectedAssetIds,
  setSelectedAssetId,
  setAssetSelectionAnchor,
  setSelectedFolderIds,
}: UseDesktopAutomationSelectionOptions): void {
  useEffect(() => {
    if (!shellApi) return;
    return shellApi.onDesktopAutomationSelection((event) => {
      if (libraryId === null || libraryId === undefined || event.libraryId !== libraryId) return;
      if (previewOpen) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      const next = applyDesktopAutomationSelection(
        { selectedAssetIds, primaryAssetId: selectedAssetId },
        event,
      );
      setSelectedAssetIds([...next.selectedAssetIds]);
      setSelectedAssetId(next.primaryAssetId);
      setAssetSelectionAnchor(next.selectedAssetIds.at(-1) ?? null);
      if (event.mode === 'replace') setSelectedFolderIds?.([]);
    });
  }, [
    libraryId,
    previewOpen,
    selectedAssetId,
    selectedAssetIds,
    setAssetSelectionAnchor,
    setSelectedAssetId,
    setSelectedAssetIds,
    setSelectedFolderIds,
    shellApi,
  ]);
}

export function desktopSelectionModeLabel(mode: DesktopSelectionMode): string {
  return mode === 'replace' ? 'replace' : mode === 'add' ? 'add' : 'remove';
}
