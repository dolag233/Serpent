import { describe, expect, it } from "vitest";

import { createWorkspaceNavigationCoordinator } from "../../src/renderer/workspace-navigation-coordinator";

describe("workspace navigation coordinator", () => {
  it("invalidates an older request when a newer request starts in the same tab", () => {
    const coordinator = createWorkspaceNavigationCoordinator("tab-a");
    const slowA = coordinator.begin("tab-a", "push");
    const fastB = coordinator.begin("tab-a", "push");

    expect(coordinator.isCurrent(slowA)).toBe(false);
    expect(coordinator.isCurrent(fastB)).toBe(true);
  });

  it("invalidates every token when the library changes", () => {
    const coordinator = createWorkspaceNavigationCoordinator("tab-a");
    const token = coordinator.begin("tab-a", "replay");

    coordinator.invalidateLibrary();

    expect(coordinator.isCurrent(token)).toBe(false);
    expect(coordinator.activeTabId).toBeNull();
  });

  it("closing an inactive tab does not invalidate the active tab request", () => {
    const coordinator = createWorkspaceNavigationCoordinator("tab-a");
    coordinator.activateTab("tab-b");
    const activeRequest = coordinator.begin("tab-b", "none");

    coordinator.closeTab("tab-a");

    expect(coordinator.isCurrent(activeRequest)).toBe(true);
  });

  it("closing other tabs while retaining the active tab preserves its request", () => {
    const coordinator = createWorkspaceNavigationCoordinator("tab-a");
    coordinator.activateTab("tab-b");
    const activeRequest = coordinator.begin("tab-b", "none");

    coordinator.closeTabsExcept("tab-b");

    expect(coordinator.isCurrent(activeRequest)).toBe(true);
  });

  it("activation invalidates the previous tab and issues fresh work on return", () => {
    const coordinator = createWorkspaceNavigationCoordinator("tab-a");
    const oldA = coordinator.begin("tab-a", "push");
    coordinator.activateTab("tab-b");
    const b = coordinator.begin("tab-b", "none");
    coordinator.activateTab("tab-a");
    const newA = coordinator.begin("tab-a", "replay");

    expect(coordinator.isCurrent(oldA)).toBe(false);
    expect(coordinator.isCurrent(b)).toBe(false);
    expect(coordinator.isCurrent(newA)).toBe(true);
  });

  it("makes a closed tab token permanently stale, even if its id is reused", () => {
    const coordinator = createWorkspaceNavigationCoordinator("tab-a");
    const oldToken = coordinator.begin("tab-a", "push");
    coordinator.closeTab("tab-a");
    coordinator.activateTab("tab-a");
    const newToken = coordinator.begin("tab-a", "none");

    expect(coordinator.isCurrent(oldToken)).toBe(false);
    expect(coordinator.isCurrent(newToken)).toBe(true);
  });

  it("does not allow a request to begin for an inactive tab", () => {
    const coordinator = createWorkspaceNavigationCoordinator("tab-a");
    expect(() => coordinator.begin("tab-b", "push")).toThrow(/inactive/);
  });
});
