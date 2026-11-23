// @vitest-environment happy-dom
import { act, createElement, Suspense, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowseLayoutEntry } from "../../src/shared/asset-types";
import { useJustifiedGeometrySnapshot } from "../../src/renderer/browse/use-justified-geometry-snapshot";
import type { JustifiedGeometrySnapshot } from "../../src/renderer/browse/justified-row-geometry";

type Input = Parameters<typeof useJustifiedGeometrySnapshot>[0];

describe("committed justified geometry snapshots", () => {
  let host: HTMLDivElement;
  let root: Root;
  let commits: Array<JustifiedGeometrySnapshot | null>;
  let releasePending: () => void;
  let pending: Promise<void>;

  function Harness({ input, suspend = false }: { input: Input; suspend?: boolean }) {
    const snapshot = useJustifiedGeometrySnapshot(input);
    useLayoutEffect(() => { commits.push(snapshot); }, [snapshot]);
    if (suspend) throw pending;
    return createElement("span", null, snapshot?.rows.length ?? 0);
  }

  async function render(input: Input, suspend = false) {
    await act(async () => {
      root.render(createElement(Suspense, { fallback: createElement("span", null, "pending") },
        createElement(Harness, { input, suspend })));
    });
  }

  function initialInput() {
    const geometryEntries = new Map<number, BrowseLayoutEntry>();
    for (let index = 0; index < 6; index += 1) {
      geometryEntries.set(index, { assetId: `fixture-${index}`, width: 100, height: 100 });
    }
    const captionBand = vi.fn(() => 20);
    return { total: 6, itemsPerRow: 2, availableWidth: 480, targetHeight: 200, captionBand, geometryEntries };
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    commits = [];
    pending = new Promise<void>(resolve => { releasePending = resolve; });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); releasePending(); });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("does not publish a suspended candidate before deriving the next committed update", async () => {
    const input = initialInput();
    await render(input);
    const first = commits.at(-1)!;
    expect(first).not.toBeNull();
    const abandonedEntries = new Map(input.geometryEntries);
    abandonedEntries.set(0, { ...abandonedEntries.get(0)!, height: 200 });
    await render({ ...input, geometryEntries: abandonedEntries }, true);
    expect(commits.at(-1)).toBe(first);

    const finalEntries = new Map(input.geometryEntries);
    finalEntries.set(5, { ...finalEntries.get(5)!, width: 200 });
    input.captionBand.mockClear();
    await render({ ...input, geometryEntries: finalEntries });
    // A cache advanced by the abandoned render would also rebuild row zero.
    expect(input.captionBand).toHaveBeenCalledTimes(2);
    expect(commits.at(-1)?.rows[0]?.widths).toBe(first!.rows[0]?.widths);
    expect(commits.at(-1)?.rows[2]?.widths).not.toBe(first!.rows[2]?.widths);
  });

  it("releases the prior dense snapshot when switching out of the dense layout", async () => {
    const input = initialInput();
    await render(input);
    const first = commits.at(-1);
    await render(null);
    expect(commits.at(-1)).toBeNull();
    input.captionBand.mockClear();
    await render(input);
    expect(input.captionBand).toHaveBeenCalledTimes(6);
    expect(commits.at(-1)).not.toBe(first);
  });
});
