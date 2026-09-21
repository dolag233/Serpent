import { expect, test } from "vitest";

import { executeBrowseSessionMainCommand } from "../../src/main/commands/browse-session";

test("browse.session.close maps session identity", () => {
  expect(executeBrowseSessionMainCommand({
    type: "browse.session.close.request",
    libraryId: "lib-1",
    sessionId: "session-1",
  })).toEqual({
    type: "browse.session.close",
    libraryId: "lib-1",
    sessionId: "session-1",
  });
});

test("ai.search-plan stays on the Main-owned planner path", () => {
  expect(executeBrowseSessionMainCommand({
    type: "ai.search-plan.request",
    naturalQuery: "red car",
  })).toBeUndefined();
});
