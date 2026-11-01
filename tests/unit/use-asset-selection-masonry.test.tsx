// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { AssetSummary } from "../../src/shared/asset-types";
import {
  publishCanvasAssetLayout,
  type CanvasAssetLayoutRect,
} from "../../src/renderer/canvas-asset-layout";
import { useAssetSelection } from "../../src/renderer/useAssetSelection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const assets = ["A", "B", "C", "D", "E", "F", "G"].map((id) => ({
  assetId: id,
  locationKind: "managed",
  managedFolderId: "folder-1",
  relativeFilePath: `${id}.png`,
  displayName: `${id}.png`,
  currentRevisionId: `rev-${id}`,
  byteSize: 1,
  modifiedAt: "2026-01-01T00:00:00.000Z",
  availability: "available",
  rating: 0,
  favorite: false,
  deletedAt: null,
  trashedFromPath: null,
  trashedFromTombstoneId: null,
  remainingDays: null,
  thumbnailStatus: "ready",
  thumbnailArtifactId: null,
  mediaType: "image",
  width: 100,
  height: 100,
  durationMs: null,
})) as AssetSummary[];

const geometry: CanvasAssetLayoutRect[] = [
  { id: "A", x: 0, y: 0, width: 100, height: 300 },
  { id: "B", x: 114, y: 0, width: 100, height: 100 },
  { id: "C", x: 228, y: 0, width: 100, height: 200 },
  { id: "D", x: 342, y: 0, width: 100, height: 150 },
  { id: "E", x: 0, y: 314, width: 100, height: 100 },
  { id: "F", x: 114, y: 114, width: 100, height: 100 },
  { id: "G", x: 228, y: 214, width: 100, height: 100 },
];

type Snapshot = {
  selectedAssetIds: string[];
  selectedFolderIds: string[];
  assetAnchor: string | null;
};

function createHarness(options?: {
  folderIds?: string[];
  masonry?: boolean;
  restoredAnchor?: string;
}) {
  let snapshot: Snapshot = {
    selectedAssetIds: [],
    selectedFolderIds: [],
    assetAnchor: null,
  };

  function Harness() {
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
    const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const gridRef = useRef<HTMLDivElement | null>(null);
    const marqueeBoxRef = useRef<HTMLDivElement | null>(null);
    const selection = useAssetSelection({
      assets,
      selectedAssetIds,
      setSelectedAssetIds,
      setSelectedAssetId: () => undefined,
      previewAsset: null,
      draggedMemberId: null,
      draggedCollectionId: null,
      workspaceCanvasRef: canvasRef,
      marqueeBoxRef,
      folderIds: options?.folderIds ?? [],
      selectedFolderIds,
      setSelectedFolderIds,
      selectionAssetIds: assets.map(({ assetId }) => assetId),
      masonryShiftSelection: options?.masonry ?? true,
      marqueeLayoutKey: "masonry-test",
    });

    useLayoutEffect(() => {
      if (gridRef.current) publishCanvasAssetLayout(gridRef.current, geometry);
      if (options?.restoredAnchor) {
        selection.setAssetSelectionAnchor(options.restoredAnchor);
      }
    }, []);

    snapshot = {
      selectedAssetIds,
      selectedFolderIds,
      assetAnchor: selection.selectionAnchorRef.current,
    };

    return createElement(
      "div",
      { ref: canvasRef },
      createElement(
        "div",
        { className: "masonry-columns", ref: gridRef },
        ...assets.map(({ assetId }) =>
          createElement(
            "button",
            {
              className: "asset-card",
              "data-asset-id": assetId,
              key: assetId,
              onClick: (event) => selection.handleCardClick(assetId, event),
            },
            assetId,
          ),
        ),
      ),
      ...(options?.folderIds ?? []).map((folderId) =>
        createElement(
          "button",
          {
            className: "folder-card",
            "data-folder-id": folderId,
            key: folderId,
            onClick: (event) => selection.handleFolderCardClick(folderId, event),
          },
          folderId,
        ),
      ),
      createElement(
        "button",
        {
          "data-anchor-setter": "B",
          onClick: () => selection.setAssetSelectionAnchor("B"),
        },
        "set-anchor",
      ),
    );
  }

  return {
    Harness,
    getSnapshot: () => snapshot,
  };
}

describe("useAssetSelection masonry Shift interaction", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = undefined;
    container?.remove();
    container = undefined;
  });

  async function renderHarness(options?: {
    folderIds?: string[];
    masonry?: boolean;
    restoredAnchor?: string;
  }) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const harness = createHarness(options);
    await act(async () => {
      root?.render(createElement(harness.Harness));
    });
    return harness;
  }

  async function click(selector: string, modifiers: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  } = {}) {
    const button = container?.querySelector<HTMLButtonElement>(selector);
    if (!button) throw new Error(`Missing test button: ${selector}`);
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, ...modifiers }));
    });
  }

  it("uses restored anchors, preserves the original anchor across repeated Shift clicks, and reverses the same range", async () => {
    const harness = await renderHarness({ restoredAnchor: "A" });
    await click('[data-asset-id="G"]', { shiftKey: true });
    expect(harness.getSnapshot().selectedAssetIds).toEqual(["A", "B", "C", "D", "F", "G"]);
    expect(harness.getSnapshot().assetAnchor).toBe("A");

    await click('[data-asset-id="F"]', { shiftKey: true });
    expect(harness.getSnapshot().selectedAssetIds).toEqual(["A", "B", "C", "D", "F"]);
    expect(harness.getSnapshot().assetAnchor).toBe("A");

    await click('[data-asset-id="G"]');
    await click('[data-asset-id="A"]', { shiftKey: true });
    expect(harness.getSnapshot().selectedAssetIds).toEqual(["A", "B", "C", "D", "F", "G"]);
  });

  it("uses the unified folder-to-asset range and preserves outside items for Ctrl+Shift", async () => {
    const harness = await renderHarness({ folderIds: ["folder-a", "folder-b"] });
    await click('[data-folder-id="folder-a"]');
    await click('[data-folder-id="folder-b"]', { ctrlKey: true });
    expect(harness.getSnapshot().selectedFolderIds).toEqual(["folder-a", "folder-b"]);
    await click('[data-asset-id="G"]', { shiftKey: true });
    expect(harness.getSnapshot().selectedFolderIds).toEqual(["folder-b"]);
    expect(harness.getSnapshot().selectedAssetIds).toEqual(["A", "B", "C", "D", "F", "G"]);

    await click('[data-asset-id="A"]');
    await click('[data-asset-id="E"]', { ctrlKey: true });
    await click('[data-asset-id="B"]', { shiftKey: true, ctrlKey: true });
    expect(harness.getSnapshot().selectedAssetIds).toEqual(["A", "E", "B", "C", "D", "F", "G"]);
  });

  it("lets a programmatic anchor update replace a prior pointer anchor", async () => {
    const harness = await renderHarness();
    await click('[data-asset-id="A"]');
    await click('[data-anchor-setter="B"]');
    await click('[data-asset-id="G"]', { shiftKey: true });

    expect(harness.getSnapshot().selectedAssetIds).toEqual(["B", "C", "D", "F", "G"]);
    expect(harness.getSnapshot().assetAnchor).toBe("B");
  });

  it("keeps non-masonry Shift ranges in their existing asset order", async () => {
    const harness = await renderHarness({ masonry: false });
    await click('[data-asset-id="B"]');
    await click('[data-asset-id="F"]', { shiftKey: true });

    expect(harness.getSnapshot().selectedAssetIds).toEqual(["B", "C", "D", "E", "F"]);
  });
});
