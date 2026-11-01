import { describe, expect, it } from "vitest";

import { viewerShowsPlaybackMenu } from "../../src/renderer/viewer-quick-settings-menu";

describe("viewerShowsPlaybackMenu", () => {
  it("gives video and GIF seek plus speed", () => {
    expect(viewerShowsPlaybackMenu({ mediaType: "video" })).toEqual({
      seek: true,
      rate: true,
    });
    expect(viewerShowsPlaybackMenu({ mediaType: "image", gif: true })).toEqual({
      seek: true,
      rate: true,
    });
  });

  it("gives audio seek without speed", () => {
    expect(viewerShowsPlaybackMenu({ mediaType: "audio" })).toEqual({
      seek: true,
      rate: false,
    });
  });

  it("hides playback on viewers that do not use the jump setting", () => {
    for (const mediaType of ["image", "model", "font", "document", "text", "other"]) {
      expect(viewerShowsPlaybackMenu({ mediaType })).toBeNull();
    }
    expect(viewerShowsPlaybackMenu({ mediaType: null })).toBeNull();
  });
});
