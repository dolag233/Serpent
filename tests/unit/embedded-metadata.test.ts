import { describe, expect, it } from "vitest";

import {
  embeddedMetadataSearchText,
  normalizeProbeEmbeddedMetadata,
} from "../../src/worker/embedded-metadata";

describe("embedded metadata normalization", () => {
  it("maps common ffprobe tags and preserves bounded custom fields", () => {
    const metadata = normalizeProbeEmbeddedMetadata({
      format: {
        tags: {
          title: "Scene 07",
          artist: "Example Artist",
          album_artist: "Example Group",
          track: "7/12",
          date: "2026-09-21",
          encoder: "fixture encoder",
          custom_fixture: "value",
        },
      },
      streams: [{ tags: { album: "Example Album", genre: "Ambient" } }],
    });

    expect(metadata).toMatchObject({
      title: "Scene 07",
      artist: "Example Artist",
      album: "Example Album",
      albumArtist: "Example Group",
      trackNumber: "7/12",
      genre: "Ambient",
      date: "2026-09-21",
    });
    expect(metadata.customTags).toEqual([
      { key: "custom_fixture", value: "value" },
    ]);
  });

  it("creates searchable text without leaking arbitrary nested values", () => {
    expect(embeddedMetadataSearchText({
      title: "Scene 07",
      artist: "Example Artist",
      customTags: [{ key: "Mood", value: "Calm" }],
    })).toBe("Scene 07 Example Artist Mood Calm");
  });
});
