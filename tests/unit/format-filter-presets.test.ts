// Serpent-1d4w: the format filter quick-chips derive from the product format
// registries. These tests pin that every registered extension has a chip and
// that tokens are dotless (they live in a comma field alongside free text).
import { describe, expect, it } from "vitest";

import {
  AUDIO_EXTENSION_NAMES,
  AUDIO_EXTENSIONS,
} from "../../src/shared/audio-media";
import {
  IMAGE_EXTENSIONS,
  MODEL_EXTENSIONS,
  VIDEO_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
} from "../../src/shared/media-formats";
import {
  FORMAT_FILTER_GROUPS,
  FORMAT_TEXT_TOKEN,
} from "../../src/renderer/format-filter-presets";

function allChipTokens(): string[] {
  return FORMAT_FILTER_GROUPS.flatMap((group) => [...group.extensions]);
}

describe("format-filter-presets", () => {
  it("covers every registered image/video/audio/document/model extension exactly once", () => {
    const chips = allChipTokens();
    const expected = [
      ...IMAGE_EXTENSIONS.map((extension) => extension.slice(1)),
      ...VIDEO_EXTENSIONS.map((extension) => extension.slice(1)),
      ...AUDIO_EXTENSION_NAMES,
      ...MODEL_EXTENSIONS.map((extension) => extension.slice(1)),
      ...DOCUMENT_EXTENSIONS.map((extension) => extension.slice(1)),
    ];
    expect(new Set(chips)).toEqual(new Set(expected));
    expect(chips.length).toBe(new Set(chips).size);
  });

  it("emits dotless tokens matching the comma-field format", () => {
    for (const token of allChipTokens()) {
      expect(token).not.toMatch(/^\./);
      expect(token).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("keeps the audio group aligned with the audio registry", () => {
    const audioGroup = FORMAT_FILTER_GROUPS.find(
      (group) => group.labelKey === "filter.formatGroupAudio",
    );
    expect(audioGroup?.extensions).toEqual(
      AUDIO_EXTENSIONS.map((extension) => extension.slice(1)),
    );
  });

  it("ships the special text token separately from extension groups", () => {
    expect(FORMAT_TEXT_TOKEN).toBe("text");
    expect(allChipTokens()).not.toContain(FORMAT_TEXT_TOKEN);
  });

  it("exposes PDF and HTML as individually selectable document formats", () => {
    const documentGroup = FORMAT_FILTER_GROUPS.find(
      (group) => group.labelKey === "filter.formatGroupDocument",
    );
    expect(documentGroup?.extensions).toEqual(["pdf", "html", "htm"]);
  });
});
