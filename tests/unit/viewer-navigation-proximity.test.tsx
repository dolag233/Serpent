// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetSummary } from "../../src/shared/asset-types";
import type { SerpentLibraryApi } from "../../src/shared/library-api";

const { translate } = vi.hoisted(() => ({ translate: (key: string) => key }));
vi.mock("../../src/renderer/i18n", () => ({ useT: () => translate }));
vi.mock("../../src/renderer/use-viewer-chrome-contrast", () => ({
  useViewerChromeContrast: () => ({ prev: "on-dark", next: "on-dark" }),
}));
// These renderers are unrelated to navigation; the fixture uses unsupported assets.
vi.mock("../../src/renderer/PdfViewerSurface", () => ({ PdfViewerSurface: () => null }));
vi.mock("../../src/renderer/3d-viewer/viewer-surface", () => ({ ModelViewerSurface: () => null }));
vi.mock("../../src/renderer/plugin-viewer-actions", () => ({ PluginViewerActionButtons: () => null }));
vi.mock("../../src/renderer/plugin-viewer-overlays", () => ({ PluginViewerOverlays: () => null }));

import { AssetPreviewModal } from "../../src/renderer/AssetPreviewModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function asset(index: number): AssetSummary {
  return {
    assetId: `asset-${index}`,
    displayName: `asset-${index}.unknown`,
    relativeFilePath: `asset-${index}.unknown`,
    currentRevisionId: `revision-${index}`,
    locationKind: "managed",
    managedFolderId: null,
    mediaType: "other",
    byteSize: 1,
    modifiedAt: "2026-10-30T00:00:00Z",
    availability: "available",
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: null,
    thumbnailArtifactId: null,
    width: null,
    height: null,
    durationMs: null,
  };
}

describe("viewer navigation with a stationary pointer", () => {
  let root: Root;
  let container: HTMLDivElement;
  const assets = [asset(0), asset(1), asset(2), asset(3)];
  const api = {
    requestPreview: vi.fn(async () => ({
      ok: true,
      value: { status: "failed", mediaType: "other", errorCode: "UNSUPPORTED_FORMAT" },
    })),
    onThumbnailEvent: () => () => undefined,
  } as unknown as SerpentLibraryApi;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800,
      width: 1000, height: 800, toJSON: () => ({}),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function flushPreview(): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  }

  async function renderViewer(initialIndex: number): Promise<void> {
    function Harness() {
      const [index, setIndex] = useState(initialIndex);
      return createElement(AssetPreviewModal, {
        api,
        asset: assets[index]!,
        libraryId: "library",
        chromeIdle: false,
        navArrowsOnApproach: true,
        onChromeActivity: () => undefined,
        onClose: () => undefined,
        onPrevious: index > 0 ? () => setIndex((value) => value - 1) : undefined,
        onNext: index < assets.length - 1 ? () => setIndex((value) => value + 1) : undefined,
      });
    }
    await act(async () => root.render(createElement(Harness)));
    await flushPreview();
  }

  function button(side: "prev" | "next"): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>(
      `.workspace-viewer:not(.is-preview-preloading) .preview-nav.is-${side}`,
    )!;
  }

  it.each(["next", "prev"] as const)(
    "keeps the %s arrow available through repeated clicks without a pointer move",
    async (side) => {
      await renderViewer(side === "next" ? 0 : 3);
      await act(async () => {
        button(side).dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true, clientX: side === "next" ? 970 : 30, clientY: 400, movementX: 1,
        }));
      });

      for (let count = 0; count < 3; count += 1) {
        const current = button(side);
        expect(current.disabled).toBe(false);
        expect(current.closest(`.is-nav-near-${side}`)).not.toBeNull();
        await act(async () => current.click());
        await flushPreview();
        // The media surface was replaced, but the same pointer location still
        // reveals the replacement arrow. No mouse movement is sent here.
        expect(button(side).closest(`.is-nav-near-${side}`)).not.toBeNull();
        expect(button(side)).not.toBe(current);
      }
      expect(button(side).disabled).toBe(true);
    },
  );

  it("hides proximity arrows again after moving away or leaving the window", async () => {
    await renderViewer(1);
    const move = async (clientX: number) => act(async () => {
      button("next").dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, clientX, clientY: 400, movementX: 1,
      }));
    });
    await move(970);
    expect(button("next").closest(".is-nav-near-next")).not.toBeNull();
    await move(500);
    expect(button("next").closest(".is-nav-near-next")).toBeNull();
    await move(970);
    await act(async () => {
      button("next").dispatchEvent(new PointerEvent("pointerout", {
        bubbles: true, relatedTarget: null,
      }));
    });
    expect(button("next").closest(".is-nav-near-next")).toBeNull();
  });
});
