import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  addWorkspaceTab,
  closeWorkspaceTab,
  closeWorkspaceTabsExcept,
  createWorkspaceTabs,
  getWorkspaceTab,
  selectWorkspaceTab,
  updateWorkspaceTabBrowseState,
  updateWorkspaceTabContext,
  type WorkspaceTabBrowseState,
  type WorkspaceTabSession,
  type WorkspaceTabsState,
} from "./workspace-tabs";
import type { WorkspaceNavHistory } from "./workspace-nav-history";

export interface WorkspaceTabCapturedContext {
  viewport: WorkspaceTabSession["history"]["currentViewport"];
  selectedAssetIds: readonly string[];
  selectedAssetId: string | null;
  browseState: WorkspaceTabBrowseState;
  cachedTitle: string;
}

export interface UseWorkspaceTabsControllerOptions {
  captureContext: () => WorkspaceTabCapturedContext;
  restoreTab: (
    tab: WorkspaceTabSession,
    isCurrent: () => boolean,
  ) => Promise<void>;
  restoreAll: (isCurrent: () => boolean) => Promise<void>;
  beginTransition: () => () => boolean;
  getDefaultBrowseState: () => WorkspaceTabBrowseState;
  onHistoryChanged: (history: WorkspaceNavHistory) => void;
}

/** Owns tab lifetimes and keeps each tab paired with its independent history. */
export function useWorkspaceTabsController(options: UseWorkspaceTabsControllerOptions) {
  const [state, setState] = useState(createWorkspaceTabs);
  const stateRef = useRef(state);
  const historyRef = useRef(state.tabs[0]!.history);
  const callbacksRef = useRef(options);
  const transitionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const transitionEpochRef = useRef(0);
  useLayoutEffect(() => {
    callbacksRef.current = options;
  }, [options]);

  const commit = useCallback((next: WorkspaceTabsState) => {
    stateRef.current = next;
    const activeTab = getWorkspaceTab(next, next.activeTabId);
    if (activeTab) historyRef.current = activeTab.history;
    setState(next);
    if (activeTab) callbacksRef.current.onHistoryChanged(activeTab.history);
  }, []);

  const saveActiveContext = useCallback(() => {
    const current = stateRef.current;
    const active = getWorkspaceTab(current, current.activeTabId);
    if (!active) return current;
    const captured = callbacksRef.current.captureContext();
    active.history.saveCurrentViewport(captured.viewport);
    let next = updateWorkspaceTabContext(current, active.id, captured);
    next = updateWorkspaceTabBrowseState(next, active.id, captured.browseState);
    stateRef.current = next;
    return next;
  }, []);

  const enqueueTransition = useCallback(
    (operation: (epoch: number, isRequestCurrent: () => boolean) => Promise<void>) => {
      const isRequestCurrent = callbacksRef.current.beginTransition();
      const requestedEpoch = transitionEpochRef.current;
      const pending = transitionQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (
            requestedEpoch !== transitionEpochRef.current ||
            !isRequestCurrent()
          ) return;
          await operation(requestedEpoch, isRequestCurrent);
        });
      transitionQueueRef.current = pending.catch(() => undefined);
      return pending;
    },
    [],
  );

  const restoreActive = useCallback(async (
    next: WorkspaceTabsState,
    epoch: number,
    isRequestCurrent: () => boolean,
  ) => {
    const tab = getWorkspaceTab(next, next.activeTabId);
    if (!tab) return;
    historyRef.current = tab.history;
    callbacksRef.current.onHistoryChanged(tab.history);
    await callbacksRef.current.restoreTab(
      tab,
      () =>
        epoch === transitionEpochRef.current &&
        stateRef.current.activeTabId === tab.id &&
        isRequestCurrent(),
    );
  }, []);

  const selectTab = useCallback(
    (tabId: string) => enqueueTransition(async (epoch, isRequestCurrent) => {
      const current = stateRef.current;
      if (current.activeTabId === tabId || !getWorkspaceTab(current, tabId)) return;
      const saved = saveActiveContext();
      const next = selectWorkspaceTab(saved, tabId);
      commit(next);
      await restoreActive(next, epoch, isRequestCurrent);
    }),
    [commit, enqueueTransition, restoreActive, saveActiveContext],
  );

  const addTab = useCallback(
    () => enqueueTransition(async (epoch, isRequestCurrent) => {
      const saved = saveActiveContext();
      let next = addWorkspaceTab(saved);
      next = updateWorkspaceTabBrowseState(
        next,
        next.activeTabId,
        callbacksRef.current.getDefaultBrowseState(),
      );
      commit(next);
      await restoreActive(next, epoch, isRequestCurrent);
    }),
    [commit, enqueueTransition, restoreActive, saveActiveContext],
  );

  const closeTab = useCallback(
    (tabId: string) => enqueueTransition(async (epoch, isRequestCurrent) => {
      const current = stateRef.current;
      const saved = current.activeTabId === tabId ? saveActiveContext() : current;
      const result = closeWorkspaceTab(saved, tabId);
      if (result.state === saved) return;
      let next = result.state;
      if (result.shouldNavigateToAll && result.removedTabIds.length === 0) {
        next = updateWorkspaceTabBrowseState(
          next,
          next.activeTabId,
          callbacksRef.current.getDefaultBrowseState(),
        );
      }
      commit(next);
      if (result.shouldNavigateToAll) {
        if (result.removedTabIds.length === 0) {
          await callbacksRef.current.restoreAll(
            () =>
              epoch === transitionEpochRef.current &&
              stateRef.current.activeTabId === next.activeTabId &&
              isRequestCurrent(),
          );
        } else {
          await restoreActive(next, epoch, isRequestCurrent);
        }
      }
    }),
    [commit, enqueueTransition, restoreActive, saveActiveContext],
  );

  const closeOtherTabs = useCallback(
    (tabId: string) => enqueueTransition(async (epoch, isRequestCurrent) => {
      const saved = saveActiveContext();
      const result = closeWorkspaceTabsExcept(saved, tabId);
      if (result.state === saved) return;
      commit(result.state);
      if (result.shouldNavigateToAll) {
        await restoreActive(result.state, epoch, isRequestCurrent);
      }
    }),
    [commit, enqueueTransition, restoreActive, saveActiveContext],
  );

  const resetTabs = useCallback(() => {
    transitionEpochRef.current += 1;
    callbacksRef.current.beginTransition();
    const next = createWorkspaceTabs();
    commit(next);
  }, [commit]);

  return {
    state,
    stateRef,
    activeTabId: state.activeTabId,
    historyRef,
    selectTab,
    addTab,
    closeTab,
    closeOtherTabs,
    resetTabs,
    saveActiveContext,
  };
}
