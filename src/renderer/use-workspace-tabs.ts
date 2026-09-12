import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  addWorkspaceTab,
  closeWorkspaceTab,
  closeWorkspaceTabsExcept,
  createWorkspaceTabs,
  getWorkspaceTab,
  moveWorkspaceTab,
  selectWorkspaceTab,
  updateWorkspaceTabBrowseState,
  updateWorkspaceTabContext,
  type WorkspaceTabBrowseState,
  type WorkspaceTabSession,
  type WorkspaceTabsState,
} from "./workspace-tabs";
import {
  createWorkspaceTabsFromSession,
  type StoredWorkspaceTabsSession,
} from "./workspace-tabs-session";
import type { WorkspaceNavHistory } from "./workspace-nav-history";
import {
  createWorkspaceNavigationCoordinator,
  type WorkspaceNavigationHistoryMode,
  type WorkspaceNavigationToken,
} from "./workspace-navigation-coordinator";
import {
  createWorkspaceRenderSnapshotCache,
  type WorkspaceRenderSnapshot,
} from "./workspace-render-snapshot-cache";

export interface WorkspaceTabCapturedContext {
  viewport: WorkspaceTabSession["history"]["currentViewport"];
  selectedAssetIds: readonly string[];
  selectedAssetId: string | null;
  browseState: WorkspaceTabBrowseState;
  cachedTitle: string;
  renderSnapshot: WorkspaceRenderSnapshot | null;
}

export interface UseWorkspaceTabsControllerOptions {
  captureContext: () => WorkspaceTabCapturedContext | null;
  restoreTab: (
    tab: WorkspaceTabSession,
    isCurrent: () => boolean,
  ) => Promise<void>;
  restoreAll: (isCurrent: () => boolean) => Promise<void>;
  beginTransition: () => () => boolean;
  getDefaultBrowseState: () => WorkspaceTabBrowseState;
  onHistoryChanged: (history: WorkspaceNavHistory) => void;
  /**
   * Persists the strip after a user tab action. Locations come straight off the
   * live histories, so this stays accurate without a separate save step, and
   * tearing the strip down for a library change never writes a session.
   */
  persistTabs: (state: WorkspaceTabsState) => void;
}

/** Owns tab lifetimes and keeps each tab paired with its independent history. */
export function useWorkspaceTabsController(options: UseWorkspaceTabsControllerOptions) {
  const [state, setState] = useState(createWorkspaceTabs);
  const stateRef = useRef(state);
  const historyRef = useRef(state.tabs[0]!.history);
  const callbacksRef = useRef(options);
  const transitionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const transitionEpochRef = useRef(0);
  const [navigation] = useState(() =>
    createWorkspaceNavigationCoordinator(state.activeTabId),
  );
  const [renderSnapshotCache] = useState(createWorkspaceRenderSnapshotCache);
  useLayoutEffect(() => {
    callbacksRef.current = options;
  }, [options]);

  const commit = useCallback((next: WorkspaceTabsState, persist = true) => {
    stateRef.current = next;
    const activeTab = getWorkspaceTab(next, next.activeTabId);
    if (activeTab) historyRef.current = activeTab.history;
    setState(next);
    if (activeTab) callbacksRef.current.onHistoryChanged(activeTab.history);
    if (persist) callbacksRef.current.persistTabs(next);
  }, []);

  const saveActiveContext = useCallback(() => {
    const current = stateRef.current;
    const active = getWorkspaceTab(current, current.activeTabId);
    if (!active) return current;
    const captured = callbacksRef.current.captureContext();
    if (!captured) return current;
    active.history.saveCurrentViewport(captured.viewport);
    if (captured.renderSnapshot) {
      renderSnapshotCache.set(active.id, captured.renderSnapshot);
    } else {
      renderSnapshotCache.delete(active.id);
    }
    let next = updateWorkspaceTabContext(current, active.id, captured);
    next = updateWorkspaceTabBrowseState(next, active.id, captured.browseState);
    stateRef.current = next;
    return next;
  }, [renderSnapshotCache]);

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
    navigationToken?: WorkspaceNavigationToken,
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
        isRequestCurrent() &&
        (navigationToken === undefined ||
          navigation.isCurrent(navigationToken)),
    );
  }, [navigation]);

  const selectTab = useCallback(
    (tabId: string) => enqueueTransition(async (epoch, isRequestCurrent) => {
      const current = stateRef.current;
      if (current.activeTabId === tabId || !getWorkspaceTab(current, tabId)) return;
      const saved = saveActiveContext();
      const next = selectWorkspaceTab(saved, tabId);
      navigation.activateTab(tabId);
      const navigationToken = navigation.begin(tabId, "none");
      commit(next);
      await restoreActive(next, epoch, isRequestCurrent, navigationToken);
    }),
    [commit, enqueueTransition, navigation, restoreActive, saveActiveContext],
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
      navigation.activateTab(next.activeTabId);
      const navigationToken = navigation.begin(next.activeTabId, "none");
      commit(next);
      await restoreActive(next, epoch, isRequestCurrent, navigationToken);
    }),
    [commit, enqueueTransition, navigation, restoreActive, saveActiveContext],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      const immediateState = stateRef.current;
      if (immediateState.activeTabId !== tabId) {
        const result = closeWorkspaceTab(immediateState, tabId);
        if (result.state === immediateState) return Promise.resolve();
        navigation.closeTab(tabId);
        for (const removedTabId of result.removedTabIds) {
          renderSnapshotCache.delete(removedTabId);
        }
        commit(result.state);
        return Promise.resolve();
      }
      return enqueueTransition(async (epoch, isRequestCurrent) => {
      const current = stateRef.current;
      const saved = current.activeTabId === tabId ? saveActiveContext() : current;
      const result = closeWorkspaceTab(saved, tabId);
      if (result.state === saved) return;
      for (const removedTabId of result.removedTabIds) {
        navigation.closeTab(removedTabId);
        renderSnapshotCache.delete(removedTabId);
      }
      let next = result.state;
      if (result.shouldNavigateToAll && result.removedTabIds.length === 0) {
        next = updateWorkspaceTabBrowseState(
          next,
          next.activeTabId,
          callbacksRef.current.getDefaultBrowseState(),
        );
      }
      let navigationToken: WorkspaceNavigationToken | undefined;
      if (result.shouldNavigateToAll) {
        if (result.removedTabIds.length > 0) {
          navigation.activateTab(next.activeTabId);
        }
        navigationToken = navigation.begin(next.activeTabId, "none");
      }
      commit(next);
      if (result.shouldNavigateToAll) {
        if (result.removedTabIds.length === 0) {
          await callbacksRef.current.restoreAll(
            () =>
              epoch === transitionEpochRef.current &&
              stateRef.current.activeTabId === next.activeTabId &&
              isRequestCurrent() &&
              (navigationToken === undefined ||
                navigation.isCurrent(navigationToken)),
          );
        } else {
          await restoreActive(next, epoch, isRequestCurrent, navigationToken);
        }
      }
      });
    },
    [commit, enqueueTransition, navigation, renderSnapshotCache, restoreActive, saveActiveContext],
  );

  const closeOtherTabs = useCallback(
    (tabId: string) => {
      const immediateState = stateRef.current;
      if (immediateState.activeTabId === tabId) {
        const result = closeWorkspaceTabsExcept(immediateState, tabId);
        if (result.state === immediateState) return Promise.resolve();
        for (const removedTabId of result.removedTabIds) {
          navigation.closeTab(removedTabId);
          renderSnapshotCache.delete(removedTabId);
        }
        commit(result.state);
        return Promise.resolve();
      }
      return enqueueTransition(async (epoch, isRequestCurrent) => {
      const saved = saveActiveContext();
      const result = closeWorkspaceTabsExcept(saved, tabId);
      if (result.state === saved) return;
      for (const removedTabId of result.removedTabIds) {
        navigation.closeTab(removedTabId);
        renderSnapshotCache.delete(removedTabId);
      }
      navigation.activateTab(tabId);
      const navigationToken = navigation.begin(tabId, "none");
      commit(result.state);
      if (result.shouldNavigateToAll) {
        await restoreActive(result.state, epoch, isRequestCurrent, navigationToken);
      }
      });
    },
    [commit, enqueueTransition, navigation, renderSnapshotCache, restoreActive, saveActiveContext],
  );

  const resetTabs = useCallback(() => {
    transitionEpochRef.current += 1;
    callbacksRef.current.beginTransition();
    const next = createWorkspaceTabs();
    navigation.invalidateLibrary();
    navigation.activateTab(next.activeTabId);
    renderSnapshotCache.clear();
    // Closing or switching a library tears the strip down; the next library's
    // own session must survive, so this teardown is never written.
    commit(next, false);
  }, [commit, navigation, renderSnapshotCache]);

  /**
   * Rebuilds the strip for the library that just opened. Tab content itself is
   * restored lazily: the startup browse session owns the active tab, and any
   * other tab is loaded the first time the user selects it.
   *
   * Returns the rebuilt state and skips the persist hook: this runs during the
   * startup restore, before `library` has re-rendered, so the caller writes the
   * session against the library id it already knows.
   */
  const restoreTabs = useCallback(
    (session: StoredWorkspaceTabsSession | null): WorkspaceTabsState => {
      transitionEpochRef.current += 1;
      callbacksRef.current.beginTransition();
      const next = session
        ? createWorkspaceTabsFromSession(session)
        : createWorkspaceTabs();
      navigation.invalidateLibrary();
      navigation.activateTab(next.activeTabId);
      renderSnapshotCache.clear();
      commit(next, false);
      return next;
    },
    [commit, navigation, renderSnapshotCache],
  );

  /** Reordering changes the strip only — never identity, content, or focus. */
  const moveTab = useCallback(
    (tabId: string, toIndex: number) => {
      const next = moveWorkspaceTab(stateRef.current, tabId, toIndex);
      if (next === stateRef.current) return;
      commit(next);
    },
    [commit],
  );

  const beginNavigation = useCallback(
    (historyMode: WorkspaceNavigationHistoryMode = "push") => {
      transitionEpochRef.current += 1;
      callbacksRef.current.beginTransition();
      return navigation.begin(
        stateRef.current.activeTabId,
        historyMode,
      );
    },
    [navigation],
  );
  const isNavigationCurrent = useCallback(
    (token: WorkspaceNavigationToken) =>
      navigation.isCurrent(token),
    [navigation],
  );
  const activateRenderSnapshotLibrary = useCallback((libraryId: string | null) => {
    renderSnapshotCache.activateLibrary(libraryId);
  }, [renderSnapshotCache]);
  const getRenderSnapshot = useCallback((tabId: string) =>
    renderSnapshotCache.get(tabId),
  [renderSnapshotCache]);
  const clearRenderSnapshots = useCallback(() => {
    renderSnapshotCache.clear();
  }, [renderSnapshotCache]);

  return {
    state,
    stateRef,
    activeTabId: state.activeTabId,
    historyRef,
    selectTab,
    addTab,
    closeTab,
    closeOtherTabs,
    moveTab,
    resetTabs,
    restoreTabs,
    saveActiveContext,
    beginNavigation,
    isNavigationCurrent,
    activateRenderSnapshotLibrary,
    getRenderSnapshot,
    clearRenderSnapshots,
  };
}
