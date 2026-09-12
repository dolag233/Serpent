import { describe, expect, it } from "vitest";

import type { SessionStorage } from "../../src/renderer/session-storage";
import {
  buildWorkspaceTabsSession,
  createWorkspaceTabsFromSession,
  readWorkspaceTabsSession,
  workspaceTabsSessionKey,
  writeWorkspaceTabsSession,
} from "../../src/renderer/workspace-tabs-session";
import {
  addWorkspaceTab,
  createWorkspaceTabs,
  selectWorkspaceTab,
} from "../../src/renderer/workspace-tabs";

function fakeStorage(initial: Record<string, string> = {}): SessionStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("workspace tabs session", () => {
  it("round-trips tab order, identity, active tab and per-tab location", () => {
    let state = createWorkspaceTabs(() => "tab-a");
    state.tabs[0]!.history.push({ kind: "folder", folderId: "folder-a" });
    state = addWorkspaceTab(state, () => "tab-b");
    state.tabs[1]!.history.push({
      kind: "collection",
      collectionId: "collection-a",
      recursive: true,
    });
    state = addWorkspaceTab(state, () => "tab-c");
    state = selectWorkspaceTab(state, "tab-b");

    const storage = fakeStorage();
    writeWorkspaceTabsSession(
      "library-1",
      buildWorkspaceTabsSession(state),
      storage,
    );

    const restored = readWorkspaceTabsSession("library-1", storage);
    expect(restored).toEqual({
      version: 1,
      activeTabId: "tab-b",
      tabs: [
        { id: "tab-a", location: { kind: "folder", folderId: "folder-a" } },
        {
          id: "tab-b",
          location: {
            kind: "collection",
            collectionId: "collection-a",
            recursive: true,
          },
        },
        { id: "tab-c", location: { kind: "all" } },
      ],
    });

    const rebuilt = createWorkspaceTabsFromSession(restored!);
    expect(rebuilt.tabs.map((tab) => tab.id)).toEqual(["tab-a", "tab-b", "tab-c"]);
    expect(rebuilt.activeTabId).toBe("tab-b");
    expect(rebuilt.tabs[1]!.history.current).toEqual({
      kind: "collection",
      collectionId: "collection-a",
      recursive: true,
    });
    expect(rebuilt.tabs[1]!.history.canBack).toBe(true);
    expect(rebuilt.tabs[2]!.history.canBack).toBe(false);
  });

  it("keeps each library's strip separate", () => {
    const storage = fakeStorage();
    writeWorkspaceTabsSession("library-1", {
      version: 1,
      activeTabId: "a",
      tabs: [{ id: "a", location: { kind: "all" } }],
    }, storage);
    writeWorkspaceTabsSession("library-2", {
      version: 1,
      activeTabId: "b",
      tabs: [
        { id: "b", location: { kind: "root" } },
        { id: "c", location: { kind: "trash", tombstoneId: "tombstone-1" } },
      ],
    }, storage);

    expect(readWorkspaceTabsSession("library-1", storage)?.tabs).toHaveLength(1);
    expect(readWorkspaceTabsSession("library-2", storage)?.tabs).toHaveLength(2);
    expect(storage.data[workspaceTabsSessionKey("library-1")]).toContain('"a"');
  });

  it("rejects a damaged entry instead of restoring a partial strip", () => {
    const cases: unknown[] = [
      null,
      "not-json",
      [],
      { version: 2, activeTabId: "a", tabs: [{ id: "a", location: { kind: "all" } }] },
      { version: 1, activeTabId: "a", tabs: [] },
      { version: 1, activeTabId: "a", tabs: [{ id: "", location: { kind: "all" } }] },
      { version: 1, activeTabId: "a", tabs: [{ id: "a", location: { kind: "nope" } }] },
      { version: 1, activeTabId: "a", tabs: [{ id: "a", location: { kind: "folder" } }] },
      {
        version: 1,
        activeTabId: "a",
        tabs: [
          { id: "a", location: { kind: "all" } },
          { id: "a", location: { kind: "root" } },
        ],
      },
    ];
    for (const value of cases) {
      const raw = typeof value === "string" ? value : JSON.stringify(value);
      expect(
        readWorkspaceTabsSession(
          "library-1",
          fakeStorage({ [workspaceTabsSessionKey("library-1")]: raw }),
        ),
      ).toBeNull();
    }
  });

  it("falls back to the first tab when the stored active tab is unknown", () => {
    const storage = fakeStorage({
      [workspaceTabsSessionKey("library-1")]: JSON.stringify({
        version: 1,
        activeTabId: "missing",
        tabs: [
          { id: "a", location: { kind: "all" } },
          { id: "b", location: { kind: "root" } },
        ],
      }),
    });
    expect(readWorkspaceTabsSession("library-1", storage)?.activeTabId).toBe("a");
  });

  it("has no session to read without storage or a stored entry", () => {
    expect(readWorkspaceTabsSession("library-1", undefined)).toBeNull();
    expect(readWorkspaceTabsSession("library-1", fakeStorage())).toBeNull();
  });
});
