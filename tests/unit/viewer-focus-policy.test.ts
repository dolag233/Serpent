import { describe, expect, it } from "vitest";

import { VIEWER_CHROME_TAB_INDEX } from "../../src/renderer/viewer-focus-policy";

describe("viewer focus policy", () => {
  it("keeps viewer controls reachable from the document Tab order", () => {
    expect(VIEWER_CHROME_TAB_INDEX).toBe(0);
  });
});
