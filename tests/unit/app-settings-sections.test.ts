import { describe, expect, it } from "vitest";
import {
  APP_SETTINGS_CANVAS_BADGE_FIELD_OPTIONS,
  APP_SETTINGS_CANVAS_CAPTION_FIELD_OPTIONS,
  APP_SETTINGS_CANVAS_FIELD_OPTIONS,
  APP_SETTINGS_CATEGORIES,
  APP_SETTINGS_CARD_BADGES_HINT_KEY,
  APP_SETTINGS_CARD_FIELDS_HINT_KEY,
  APP_SETTINGS_LOCALE_OPTIONS,
  APP_SETTINGS_THEME_OPTIONS,
  canvasFieldOptionsUseSharedHint,
  isAppSettingsCategoryId,
  type AppSettingsCanvasFieldOption,
} from "../../src/renderer/app-settings-sections";

describe("app-settings-sections (Serpent-97l / Serpent-9es / Serpent-i07)", () => {
  it("theme and locale option lists are non-empty", () => {
    expect(APP_SETTINGS_THEME_OPTIONS.length).toBe(3);
    expect(APP_SETTINGS_LOCALE_OPTIONS.length).toBe(3);
  });

  it("lists system theme first (Serpent-svc default policy)", () => {
    expect(APP_SETTINGS_THEME_OPTIONS.map((o) => o.value)).toEqual([
      "system",
      "light",
      "dark",
    ]);
    expect(APP_SETTINGS_LOCALE_OPTIONS[0]?.value).toBe("system");
  });

  it("uses stable, user-facing settings categories", () => {
    expect(APP_SETTINGS_CATEGORIES.map((category) => category.id)).toEqual([
      "general",
      "assets",
      "appearance",
      "browse",
      "ai",
      "mcp",
      "plugins",
      "sync",
    ]);
    expect(isAppSettingsCategoryId("assets")).toBe(true);
    expect(isAppSettingsCategoryId("ai")).toBe(true);
    expect(isAppSettingsCategoryId("plugins")).toBe(true);
    expect(isAppSettingsCategoryId("sync")).toBe(true);
    expect(isAppSettingsCategoryId("internal-telemetry")).toBe(false);
  });

  it("splits caption fields and corner badges into separate groups", () => {
    expect(APP_SETTINGS_CARD_FIELDS_HINT_KEY).toBe("settings.cardFieldsHint");
    expect(APP_SETTINGS_CARD_BADGES_HINT_KEY).toBe("settings.cardBadgesHint");
    expect(APP_SETTINGS_CANVAS_CAPTION_FIELD_OPTIONS.map((o) => o.field)).toEqual([
      "name",
      "size",
      "date",
    ]);
    expect(APP_SETTINGS_CANVAS_BADGE_FIELD_OPTIONS.map((o) => o.field)).toEqual([
      "badgeDuration",
      "badgeExtension",
      "badgeType",
      "badgeSource",
    ]);
    expect(APP_SETTINGS_CANVAS_FIELD_OPTIONS.map((o) => o.field)).toEqual([
      "name",
      "size",
      "date",
      "badgeDuration",
      "badgeExtension",
      "badgeType",
      "badgeSource",
    ]);
    expect(canvasFieldOptionsUseSharedHint()).toBe(true);
    expect(
      canvasFieldOptionsUseSharedHint(
        APP_SETTINGS_CANVAS_BADGE_FIELD_OPTIONS,
        APP_SETTINGS_CARD_BADGES_HINT_KEY,
      ),
    ).toBe(true);

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
        APP_SETTINGS_CANVAS_CAPTION_FIELD_OPTIONS,
        "settings.themeHint",
      ),
    ).toBe(false);
  });
});
