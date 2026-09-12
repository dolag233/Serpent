export type WorkspaceNavigationHistoryMode = "push" | "replay" | "none";

export interface WorkspaceNavigationToken {
  readonly libraryEpoch: number;
  readonly tabId: string;
  readonly tabGeneration: number;
  readonly historyMode: WorkspaceNavigationHistoryMode;
}

export interface WorkspaceNavigationCoordinator {
  readonly activeTabId: string | null;
  activateTab(tabId: string): void;
  begin(
    tabId: string,
    historyMode: WorkspaceNavigationHistoryMode,
  ): WorkspaceNavigationToken;
  isCurrent(token: WorkspaceNavigationToken): boolean;
  closeTab(tabId: string): void;
  closeTabsExcept(tabId: string): void;
  invalidateLibrary(): void;
}

/**
 * Tracks which asynchronous navigation is allowed to commit. Generations are
 * globally monotonic so a closed tab id can never accidentally reuse an old
 * token if it is later re-created.
 */
export function createWorkspaceNavigationCoordinator(
  initialActiveTabId: string | null = null,
): WorkspaceNavigationCoordinator {
  let libraryEpoch = 0;
  let nextGeneration = 0;
  let activeTabId = initialActiveTabId;
  const generationByTab = new Map<string, number>();

  const advance = (tabId: string): number => {
    const generation = ++nextGeneration;
    generationByTab.set(tabId, generation);
    return generation;
  };

  if (initialActiveTabId !== null) advance(initialActiveTabId);

  return {
    get activeTabId() {
      return activeTabId;
    },
    activateTab(tabId) {
      if (tabId.length === 0) throw new Error("tabId must not be empty");
      if (activeTabId === tabId) return;
      activeTabId = tabId;
      advance(tabId);
    },
    begin(tabId, historyMode) {
      if (activeTabId !== tabId) {
        throw new Error("Cannot begin navigation for an inactive workspace tab");
      }
      return Object.freeze({
        libraryEpoch,
        tabId,
        tabGeneration: advance(tabId),
        historyMode,
      });
    },
    isCurrent(token) {
      return (
        token.libraryEpoch === libraryEpoch &&
        token.tabId === activeTabId &&
        token.tabGeneration === generationByTab.get(token.tabId)
      );
    },
    closeTab(tabId) {
      generationByTab.delete(tabId);
      if (activeTabId === tabId) activeTabId = null;
    },
    closeTabsExcept(tabId) {
      for (const existingId of generationByTab.keys()) {
        if (existingId !== tabId) generationByTab.delete(existingId);
      }
      if (activeTabId !== tabId) {
        activeTabId = tabId;
        advance(tabId);
      }
    },
    invalidateLibrary() {
      libraryEpoch += 1;
      activeTabId = null;
      generationByTab.clear();
    },
  };
}
