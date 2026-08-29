import { describe, expect, it } from "vitest";

import {
  advanceLibraryViewSession,
  invalidateLibraryViewSession,
  isCurrentLibraryViewSession,
  type LibraryViewSessionToken,
} from "../../src/renderer/library-view-session";

describe("library view session", () => {
  it("makes every replacement a new session, including a reopen of the same id", () => {
    const initial = { libraryId: "library-a", generation: 3 } as const;
    const reopened = advanceLibraryViewSession(initial, "library-a");
    const switched = advanceLibraryViewSession(reopened, "library-b");

    expect(reopened).toEqual({ libraryId: "library-a", generation: 4 });
    expect(switched).toEqual({ libraryId: "library-b", generation: 5 });
  });

  it("invalidates an in-flight token without changing the active library", () => {
    const current = { libraryId: "library-a", generation: 7 } as const;
    const token: LibraryViewSessionToken = current;
    const next = invalidateLibraryViewSession(current);

    expect(next.libraryId).toBe("library-a");
    expect(isCurrentLibraryViewSession(next, token)).toBe(false);
  });

  it("requires both the library id and generation to match", () => {
    const current = { libraryId: "library-b", generation: 9 } as const;

    expect(
      isCurrentLibraryViewSession(current, {
        libraryId: "library-b",
        generation: 9,
      }),
    ).toBe(true);
    expect(
      isCurrentLibraryViewSession(current, {
        libraryId: "library-a",
        generation: 9,
      }),
    ).toBe(false);
    expect(
      isCurrentLibraryViewSession(current, {
        libraryId: "library-b",
        generation: 8,
      }),
    ).toBe(false);
  });
});
