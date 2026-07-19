import { describe, expect, it } from "vitest";
import {
  APP_SETTINGS_CANVAS_FIELD_OPTIONS,
  APP_SETTINGS_CARD_FIELDS_HINT_KEY,
  APP_SETTINGS_LOCALE_OPTIONS,
  APP_SETTINGS_THEME_OPTIONS,
  canvasFieldOptionsUseSharedHint,
  type AppSettingsCanvasFieldOption,
} from "../../src/renderer/app-settings-sections";

describe("app-settings-sections (Serpent-97l / Serpent-9es)", () => {
  it("theme and locale option lists are non-empty", () => {
    expect(APP_SETTINGS_THEME_OPTIONS.length).toBe(3);
    expect(APP_SETTINGS_LOCALE_OPTIONS.length).toBe(3);
  });

  it("card field toggles share one group hint and have no per-field copy", () => {
    expect(APP_SETTINGS_CARD_FIELDS_HINT_KEY).toBe("settings.cardFieldsHint");
    expect(APP_SETTINGS_CANVAS_FIELD_OPTIONS.map((o) => o.field)).toEqual([
      "name",
      "size",
      "date",
    ]);
    expect(canvasFieldOptionsUseSharedHint()).toBe(true);

    const withPerFieldHint = [
      {
        field: "name",
        labelKey: "toolbar.showFileName",
        descriptionKey: "settings.showFileNameHint",
      },
    ] as unknown as readonly AppSettingsCanvasFieldOption[];
    expect(canvasFieldOptionsUseSharedHint(withPerFieldHint)).toBe(false);
    expect(
      canvasFieldOptionsUseSharedHint(
        APP_SETTINGS_CANVAS_FIELD_OPTIONS,
        "settings.themeHint",
      ),
    ).toBe(false);
  });
});
