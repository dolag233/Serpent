import { describe, expect, it } from "vitest";

import {
  resolveWorkspaceMouseNavAction,
  resolveWorkspaceMouseNavButton,
} from "../../src/renderer/workspace-mouse-navigation";

describe("resolveWorkspaceMouseNavButton", () => {
  it("maps Chromium side buttons to back and forward", () => {
    expect(resolveWorkspaceMouseNavButton(3)).toBe("back");
    expect(resolveWorkspaceMouseNavButton(4)).toBe("forward");
    expect(resolveWorkspaceMouseNavButton(0)).toBeNull();
    expect(resolveWorkspaceMouseNavButton(2)).toBeNull();
  });
});

describe("resolveWorkspaceMouseNavAction", () => {
  it("skips when a modal dialog is open", () => {
    expect(
      resolveWorkspaceMouseNavAction(
        { button: 3, target: null },
        { isModalOpen: true },
      ),
    ).toBeNull();
    expect(
      resolveWorkspaceMouseNavAction(
        { button: 4, target: null },
        { isModalOpen: true },
      ),
    ).toBeNull();
  });
});
