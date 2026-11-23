// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { Page } from "@playwright/test";
import {
  classifyCoverMutationUrl,
  installCanvasCoverMutationProbe,
  summarizeCoverMutationWindow,
} from "../e2e/canvas-cover-mutation-probe";

type FakeEvaluateFunction = (arg?: unknown) => unknown | Promise<unknown>;

function fakePage(): Page {
  const evaluate = async (pageFunction: FakeEvaluateFunction, arg?: unknown) => pageFunction(arg);
  return { evaluate } as unknown as Page;
}

function appendStaticCover(canvas: HTMLElement, route: "source" | "preview") {
  const card = document.createElement("button");
  card.className = "asset-card";
  const image = document.createElement("img");
  image.className = "asset-thumbnail";
  image.setAttribute("src", route === "source"
    ? "serpent://source/fake-library/fake-asset?revision=fake"
    : "serpent://preview/fake-library/fake-artifact");
  card.append(image);
  canvas.append(card);
  return { card, image };
}

function appendCanvas() {
  document.body.replaceChildren();
  const canvas = document.createElement("main");
  canvas.className = "workspace-canvas";
  document.body.append(canvas);
  return canvas;
}

describe("canvas cover mutation probe summaries", () => {
  it("classifies only the static cover route category", () => {
    expect(classifyCoverMutationUrl("serpent://source/fake-library/fake-asset?revision=fake"))
      .toBe("source-direct");
    expect(classifyCoverMutationUrl("serpent://preview/fake-library/fake-artifact"))
      .toBe("preview");
    expect(classifyCoverMutationUrl(null)).toBe("other");
    expect(classifyCoverMutationUrl("blob:temporary-preview")).toBe("other");
  });

  it("projects mutation and peak-node counters without retaining URL or asset fields", () => {
    const privateUrl = "serpent://source/fake-library/fake-asset?revision=fake";
    const summary = summarizeCoverMutationWindow({
      window: "native-scroll",
      observedMs: 4_001.8,
      relevantMutationRecords: 6.9,
      inserted: { "source-direct": 2, preview: 3, other: 1 },
      removed: { "source-direct": 1, preview: 2, other: 0 },
      srcChanged: { "source-direct": 4, preview: 0, other: 2 },
      nodes: {
        start: { total: 9_999, byCategory: { "source-direct": 1, preview: 2, other: 3 } },
        peak: { total: 50_000, byCategory: { "source-direct": 2, preview: 4, other: 5 } },
        end: { total: -1, byCategory: { "source-direct": 1, preview: 1, other: 2 } },
      },
      url: privateUrl,
      assetId: "fake-asset",
      fileName: "fake-name.png",
    } as Parameters<typeof summarizeCoverMutationWindow>[0] & Record<string, unknown>);

    expect(summary).toEqual({
      window: "native-scroll",
      observedMs: 4_001,
      relevantMutationRecords: 6,
      inserted: { "source-direct": 2, preview: 3, other: 1 },
      removed: { "source-direct": 1, preview: 2, other: 0 },
      srcChanged: { "source-direct": 4, preview: 0, other: 2 },
      nodes: {
        start: { total: 6, byCategory: { "source-direct": 1, preview: 2, other: 3 } },
        peak: { total: 11, byCategory: { "source-direct": 2, preview: 4, other: 5 } },
        end: { total: 4, byCategory: { "source-direct": 1, preview: 1, other: 2 } },
      },
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(privateUrl);
    expect(serialized).not.toContain("fake-asset");
    expect(serialized).not.toContain("fake-name.png");
  });

  it("counts a cover image removed by itself after it has lost its card ancestor", async () => {
    const canvas = appendCanvas();
    const { image } = appendStaticCover(canvas, "source");
    const probe = await installCanvasCoverMutationProbe(fakePage());
    try {
      await probe.beginWindow("quiet");
      image.remove();

      const summary = await probe.endWindow("quiet");

      expect(summary.removed["source-direct"]).toBe(1);
      expect(summary.nodes.start.total).toBe(1);
      expect(summary.nodes.end.total).toBe(0);
    } finally {
      await probe.dispose();
      document.body.replaceChildren();
    }
  });

  it("counts a cover image when its entire card is removed", async () => {
    const canvas = appendCanvas();
    const { card } = appendStaticCover(canvas, "preview");
    const probe = await installCanvasCoverMutationProbe(fakePage());
    try {
      await probe.beginWindow("quiet");
      card.remove();

      const summary = await probe.endWindow("quiet");

      expect(summary.removed.preview).toBe(1);
      expect(summary.nodes.start).toMatchObject({ total: 1, byCategory: { preview: 1 } });
      expect(summary.nodes.end).toMatchObject({ total: 0, byCategory: { preview: 0 } });
    } finally {
      await probe.dispose();
      document.body.replaceChildren();
    }
  });

  it("keeps tracked nodes aligned with the DOM when a card is inserted and removed in one batch", async () => {
    const canvas = appendCanvas();
    const probe = await installCanvasCoverMutationProbe(fakePage());
    try {
      await probe.beginWindow("quiet");
      const { card } = appendStaticCover(canvas, "source");
      card.remove();

      const summary = await probe.endWindow("quiet");

      expect(summary.nodes).toEqual({
        start: { total: 0, byCategory: { "source-direct": 0, preview: 0, other: 0 } },
        peak: { total: 0, byCategory: { "source-direct": 0, preview: 0, other: 0 } },
        end: { total: 0, byCategory: { "source-direct": 0, preview: 0, other: 0 } },
      });
    } finally {
      await probe.dispose();
      document.body.replaceChildren();
    }
  });
});
