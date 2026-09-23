import { expect, test } from "vitest";

import { executeMediaJobMainCommand } from "../../src/main/commands/media-jobs";

test("media.job-summary maps to the worker queue summary", () => {
  expect(executeMediaJobMainCommand({
    type: "media.job-summary.request",
    libraryId: "lib-1",
  })).toEqual({
    type: "media.job-summary",
    libraryId: "lib-1",
  });
});

test("plugin.list-jobs maps onto plugin.jobs.list", () => {
  expect(executeMediaJobMainCommand({
    type: "plugin.list-jobs.request",
    libraryId: "lib-1",
  })).toEqual({
    type: "plugin.jobs.list",
    libraryId: "lib-1",
  });
});
