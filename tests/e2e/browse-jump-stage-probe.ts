import type { CDPSession, Page } from "@playwright/test";
import type { SerpentLibraryApi } from "../../src/shared/library-api";

type Stage = { kind: string; atMs: number; assetId?: string; delivery?: "immediate" | "batch" };
type BrowserProbe = {
  started: number;
  stages: Stage[];
  boundAssetIds: Set<string>;
  firstVisibleAt: Map<string, number>;
  lastMissingAssetIds: string[];
  firstBandReportAt: Map<string, { immediate: number | null; prefetch: number | null }>;
};
type ProbeWindow = typeof globalThis & { __browseJumpStageProbe: BrowserProbe };

/** Opt-in timing only. Never export URLs, asset names or local paths. */
export async function installBrowseJumpStageProbe(page: Page, session: CDPSession) {
  await page.evaluate(() => {
    const probe: BrowserProbe = {
      started: 0, stages: [], boundAssetIds: new Set(), firstVisibleAt: new Map(), lastMissingAssetIds: [],
      firstBandReportAt: new Map(),
    };
    (globalThis as ProbeWindow).__browseJumpStageProbe = probe;
    const record = (kind: string) => {
      if (probe.started > 0) probe.stages.push({ kind, atMs: performance.now() - probe.started });
    };
    for (const kind of ["request", "result", "page"]) {
      addEventListener(`serpent:e2e-browse-${kind}`, () => record(kind));
    }
    addEventListener("serpent:e2e-visible-window", event => {
      if (probe.started === 0) return;
      const bands = (event as CustomEvent<{
        focused: string[]; visible: string[]; nearForward: string[]; nearBackward: string[]; scopeWarm: string[];
      }>).detail;
      const atMs = performance.now() - probe.started;
      for (const [kind, ids] of [
        ["immediate", [...bands.focused, ...bands.visible]],
        ["prefetch", [...bands.nearForward, ...bands.nearBackward, ...bands.scopeWarm]],
      ] as const) for (const id of ids) {
        const entry = probe.firstBandReportAt.get(id) ?? { immediate: null, prefetch: null };
        entry[kind] ??= atMs;
        probe.firstBandReportAt.set(id, entry);
      }
    });
    const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
    const diagnostics = (globalThis as typeof globalThis & {
      serpent: { e2e: { getRequestCount(type: string): number } };
    }).serpent.e2e;
    let reports = diagnostics.getRequestCount("asset.thumbnail.visible-window.request");
    const frame = () => {
      const next = diagnostics.getRequestCount("asset.thumbnail.visible-window.request");
      for (let index = reports; index < next; index += 1) record("visible-report");
      reports = next;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    api.onThumbnailEvent(event => {
      if (probe.started === 0) return;
      if (event.type === "asset.thumbnail.batch-ready") {
        const atMs = performance.now() - probe.started;
        probe.stages.push({ kind: "asset.thumbnail.batch-ready", atMs });
        for (const item of event.ready) {
          probe.stages.push({ kind: "asset.thumbnail.ready", atMs, assetId: item.assetId, delivery: "batch" });
        }
        return;
      }
      if (event.type === "asset.dimensions.ready" || event.type === "asset.thumbnail.ready") {
        probe.stages.push({ kind: event.type, atMs: performance.now() - probe.started, assetId: event.assetId,
          ...(event.type === "asset.thumbnail.ready" ? { delivery: "immediate" as const } : {}) });
      }
    });
    const seen = new WeakMap<HTMLImageElement, { src: string; generation: number }>();
    const loaded = new WeakMap<HTMLImageElement, string>();
    const onLoad = (image: HTMLImageElement) => {
      const src = image.getAttribute("src");
      const bound = seen.get(image);
      if (!src || bound?.src !== src || bound.generation !== probe.started || loaded.get(image) === src) return;
      loaded.set(image, src);
      if (!image.complete || image.naturalWidth === 0) return;
      record("load");
      const generation = probe.started;
      void image.decode().then(() => {
        if (probe.started === generation) record("decode");
      }, () => { if (probe.started === generation) record("decode-error"); });
    };
    const onBind = (image: HTMLImageElement) => {
      const src = image.getAttribute("src");
      if (!src?.startsWith("serpent://") || seen.get(image)?.src === src) return;
      seen.set(image, { src, generation: probe.started });
      const assetId = image.closest<HTMLElement>("[data-asset-id]")?.dataset.assetId;
      if (assetId) probe.boundAssetIds.add(assetId);
      record("bind");
      if (image.complete) onLoad(image);
    };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLImageElement) onBind(record.target);
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches("img.asset-thumbnail")) onBind(node as HTMLImageElement);
          for (const image of node.querySelectorAll<HTMLImageElement>("img.asset-thumbnail")) onBind(image);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    document.addEventListener("load", event => {
      if (event.target instanceof HTMLImageElement && event.target.matches("img.asset-thumbnail")) onLoad(event.target);
    }, true);
  });
  const requests = new Map<string, {
    route: string; epochMs: number; sentMs: number;
    headersMs?: number; finishedMs?: number; bytes?: number;
  }>();
  session.on("Network.requestWillBeSent", event => {
    const match = /^serpent:\/\/(preview|source|proxy)\//.exec(event.request.url);
    if (!match) return;
    requests.set(event.requestId, {
      route: match[1]!, epochMs: event.wallTime * 1000, sentMs: event.timestamp * 1000,
    });
  });
  session.on("Network.responseReceived", event => {
    const request = requests.get(event.requestId);
    if (request) request.headersMs = event.timestamp * 1000 - request.sentMs;
  });
  session.on("Network.loadingFinished", event => {
    const request = requests.get(event.requestId);
    if (request) {
      request.finishedMs = event.timestamp * 1000 - request.sentMs;
      request.bytes = event.encodedDataLength;
    }
  });
  await session.send("Network.enable");
  let startedEpochMs = 0;
  return {
    async reset() {
      requests.clear();
      startedEpochMs = await page.evaluate(() => {
        const probe = (globalThis as ProbeWindow).__browseJumpStageProbe;
        probe.stages = [];
        probe.boundAssetIds.clear();
        probe.firstVisibleAt.clear();
        probe.lastMissingAssetIds = [];
        probe.firstBandReportAt.clear();
        probe.started = performance.now();
        return performance.timeOrigin + probe.started;
      });
    },
    async read() {
      const observed = await page.evaluate(() => {
        const probe = (globalThis as ProbeWindow).__browseJumpStageProbe;
        return {
          stages: probe.stages.filter(stage => stage.assetId === undefined || probe.boundAssetIds.has(stage.assetId))
            .map(({ kind, atMs }) => ({ kind, atMs })),
          readyDelivery: probe.stages.filter(stage => stage.delivery !== undefined)
            .map(({ delivery, atMs }) => ({ delivery, atMs })),
          batchEvents: probe.stages.filter(stage => stage.kind === "asset.thumbnail.batch-ready")
            .map(({ atMs }) => atMs),
        };
      });
      const stages = observed.stages;
      const spans = (values: number[]) => {
        values.sort((left, right) => left - right);
        const at = (fraction: number) => values.length === 0 ? null
          : Math.round(values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)]! * 10) / 10;
        return { count: values.length, first: at(0.001), p50: at(0.5), p90: at(0.9), last: at(1) };
      };
      return {
        stages: Object.fromEntries(["request", "result", "page", "visible-report", "bind", "load", "decode", "decode-error", "asset.dimensions.ready", "asset.thumbnail.ready"]
          .map(kind => [kind, spans(stages.filter(stage => stage.kind === kind).map(stage => stage.atMs))])),
        thumbnailReadyDelivery: {
          immediate: spans(observed.readyDelivery.filter(stage => stage.delivery === "immediate").map(stage => stage.atMs)),
          batch: spans(observed.readyDelivery.filter(stage => stage.delivery === "batch").map(stage => stage.atMs)),
          batchEvents: spans(observed.batchEvents),
        },
        network: [...requests.values()].filter(request => request.epochMs >= startedEpochMs).map(request => ({
          route: request.route, atMs: Math.round(request.epochMs - startedEpochMs),
          headersMs: request.headersMs === undefined ? null : Math.round(request.headersMs),
          finishedMs: request.finishedMs === undefined ? null : Math.round(request.finishedMs),
          bytes: request.bytes ?? null,
        })),
      };
    },
  };
}
