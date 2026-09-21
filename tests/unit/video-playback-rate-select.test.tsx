// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/renderer/i18n", () => ({
  useT: () => (key: string, params?: { rate?: number }) => {
    if (key === "preview.playbackRateOption" && params?.rate !== undefined) {
      return `${params.rate}×`;
    }
    return key;
  },
}));

import { VideoPlaybackRateSelect } from "../../src/renderer/VideoPlaybackRateSelect";
import { VIDEO_PLAYBACK_RATES } from "../../src/renderer/video-player-controls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("VideoPlaybackRateSelect", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  async function renderSelect(
    value: (typeof VIDEO_PLAYBACK_RATES)[number],
    onChange: (rate: (typeof VIDEO_PLAYBACK_RATES)[number]) => void,
  ): Promise<void> {
    await act(async () => {
      root?.render(
        createElement(VideoPlaybackRateSelect, {
          onChange,
          value,
        }),
      );
    });
  }

  it("opens a listbox with 0.25–4 options and can pick a slower rate", async () => {
    const onChange = vi.fn();
    await renderSelect(1, onChange);

    const trigger = container?.querySelector(".preview-video-rate");
    expect(trigger).toBeInstanceOf(HTMLButtonElement);
    expect(trigger?.textContent).toBe("1×");
    expect(trigger?.querySelector("svg")).toBeNull();

    await act(async () => {
      (trigger as HTMLButtonElement).click();
    });

    const options = [
      ...(container?.querySelectorAll('[role="option"]') ?? []),
    ];
    expect(options.map((option) => option.textContent)).toEqual(
      VIDEO_PLAYBACK_RATES.map((rate) => `${rate}×`),
    );

    const slow = options.find((option) => option.textContent === "0.25×");
    expect(slow).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      (slow as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenCalledWith(0.25);
  });
});
