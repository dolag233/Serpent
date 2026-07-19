import { describe, expect, it } from "vitest";
import {
  APP_SETTINGS_CANVAS_FIELD_OPTIONS,
  APP_SETTINGS_LOCALE_OPTIONS,
  APP_SETTINGS_THEME_OPTIONS,
  canvasFieldOptionsHaveHints,
  type AppSettingsCanvasFieldOption,
} from "../../src/renderer/app-settings-sections";

describe("app-settings-sections (Serpent-97l)", () => {
  it("theme and locale option lists are non-empty", () => {
    expect(APP_SETTINGS_THEME_OPTIONS.length).toBe(3);
    expect(APP_SETTINGS_LOCALE_OPTIONS.length).toBe(3);
  });

  it("every canvas card field toggle has explanatory hint copy", () => {
    expect(APP_SETTINGS_CANVAS_FIELD_OPTIONS.map((o) => o.field)).toEqual([
      "name",
      "size",
      "date",
    ]);
    expect(canvasFieldOptionsHaveHints()).toBe(true);

    const missingHint = [
      {
        field: "name",
        labelKey: "toolbar.showFileName",
        descriptionKey: "toolbar.showFileName",
      },
    ] as unknown as readonly AppSettingsCanvasFieldOption[];
    expect(canvasFieldOptionsHaveHints(missingHint)).toBe(false);
  });
});
