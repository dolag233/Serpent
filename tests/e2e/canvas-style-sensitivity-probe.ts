import { expect, type Page } from "@playwright/test";
import {
  readRendererProbe,
  resetRendererCounters,
  visibleImageStats,
  type RendererProbe,
} from "./perf-bench-helpers";
import { nativeScrollCanvasDown } from "./native-canvas-scroll";

const DURATION_MS = 4_000;
const PIXELS_PER_MS = 0.4;
const IMAGE_TIMEOUT_MS = 120_000;
export type CanvasStyleSensitivityCandidate = "content-hidden" | "layout-containment" | "rows-auto";
type Phase =
  | "baseline-visible"
  | "nav-content-hidden"
  | "visible-again"
  | "hidden-again"
  | "nav-layout-contained"
  | "contained-again"
  | "nav-rows-auto"
  | "rows-auto-again";
type Box = { clientWidth: number; clientHeight: number };

export type CanvasStyleSensitivityResult = {
  scope: "isolated-catalog-diagnostic";
  candidate: CanvasStyleSensitivityCandidate;
  input: "native-mouse-wheel" | "programmatic-scroll";
  counterWindow: "native-wheel-only" | "quarter-reset-and-scroll";
  hasCpuProfilerOrTrace: false;
  notFinalOrdinaryAb: true;
  dom: {
    documentElements: number;
    navigationPaneElements: number;
    workspaceCanvasElements: number;
    navigationFolderRows: number;
    navigationTreeRows: number;
    mountedAssetCards: number;
  };
  canvasDimensionsUnchanged: true;
  deferredNavigationRows: number | null;
  windows: Array<{
    phase: Phase;
    scrollExtentPx: number;
    scrollTravelPx: number;
    visibleImageCards: number;
    decodedVisibleImages: number;
    visibleImageCoverage: number;
    renderer: RendererProbe;
  }>;
};

const twoFrames = (page: Page) => page.evaluate(() =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
);

async function readDomAndStyle(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".navigation-pane");
    const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
    const navScroll = nav?.querySelector<HTMLElement>(".navigation-scroll");
    if (!nav || !canvas || !navScroll) throw new Error("Required navigation or canvas surface is missing.");
    return {
      dom: {
        documentElements: document.querySelectorAll("*").length,
        navigationPaneElements: nav.querySelectorAll("*").length,
        workspaceCanvasElements: canvas.querySelectorAll("*").length,
        navigationFolderRows: nav.querySelectorAll("button.nav-row[data-nav-folder-kind]").length,
        navigationTreeRows: nav.querySelectorAll(".nav-tree-row:has(> .nav-row)").length,
        mountedAssetCards: canvas.querySelectorAll(".asset-card:not(.is-layout-preview)").length,
      },
      style: {
        navGeometry: {
          width: nav.clientWidth, height: nav.clientHeight,
          scrollWidth: navScroll.clientWidth, scrollHeight: navScroll.clientHeight,
          extent: navScroll.scrollHeight,
        },
        contentVisibility: nav.style.getPropertyValue("content-visibility"),
        contentVisibilityPriority: nav.style.getPropertyPriority("content-visibility"),
        contain: nav.style.getPropertyValue("contain"),
        containPriority: nav.style.getPropertyPriority("contain"),
        computedContentVisibility: getComputedStyle(nav).contentVisibility,
        navRowHeight: nav.querySelector<HTMLElement>(".nav-tree-row > .nav-row")
          ? getComputedStyle(nav.querySelector<HTMLElement>(".nav-tree-row > .nav-row")!).height
          : "",
        shellControlHeight: getComputedStyle(nav).getPropertyValue("--shell-control-height").trim(),
        navDisclosureHeight: nav.querySelector<HTMLElement>(".nav-disclosure, .nav-disclosure-spacer")
          ? getComputedStyle(nav.querySelector<HTMLElement>(".nav-disclosure, .nav-disclosure-spacer")!).height
          : "",
        canvasScrollExtent: Math.max(0, canvas.scrollHeight - canvas.clientHeight),
        focusOrder: [...nav.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")]
          .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[inert]"))
          .map((element) => `${element.tagName}:${element.tabIndex}`)
          .join(","),
        box: { clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight },
      },
    };
  });
}

async function waitForDecodedViewport(page: Page, label: string) {
  const deadline = Date.now() + IMAGE_TIMEOUT_MS;
  let stats = await visibleImageStats(page);
  while (Date.now() < deadline) {
    if (stats.imageCards > 0 && stats.decodedImages > 0 && stats.coverage >= 0.9) return stats;
    await twoFrames(page);
    stats = await visibleImageStats(page);
  }
  throw new Error("Visible image decode did not reach required coverage after " + label + ".");
}

export async function scrollFromQuarterExtent(page: Page): Promise<{
  startBox: Box;
  endBox: Box;
  extent: number;
  startTop: number;
  endTop: number;
}> {
  if (process.env.SERPENT_REAL_NAV_NATIVE_SCROLL === "1") {
    const prepared = await page.evaluate(async () => {
      const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
      if (!canvas) throw new Error("The workspace canvas is missing.");
      const startBox = { clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight };
      const extent = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
      if (extent < 2_000) throw new Error("The workspace canvas is too short for this probe.");
      const base = extent * 0.25;
      if (extent - base < 1_600) {
        throw new Error("The workspace canvas lacks room for the 1600px native wheel sequence.");
      }
      canvas.scrollTop = base;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return { startBox, extent };
    });
    await waitForDecodedViewport(page, "native scroll starting viewport");
    await resetRendererCounters(page);
    const session = await page.context().newCDPSession(page);
    try {
      const result = await nativeScrollCanvasDown(page, session, page.locator(".workspace-canvas"));
      if (result.status !== "completed") {
        throw new Error("Native canvas wheel input was unsupported; no programmatic fallback is allowed.");
      }
      if (!result.legal || result.travelPx <= 1_000) {
        throw new Error("Native canvas wheel input did not complete the required measured displacement.");
      }
      const endBox = await page.locator(".workspace-canvas").evaluate((element) => {
        if (!(element instanceof HTMLElement)) throw new Error("The canvas locator is not an HTML element.");
        return {
          clientWidth: element.clientWidth,
          clientHeight: element.clientHeight,
        };
      });
      return {
        startBox: prepared.startBox,
        endBox,
        extent: prepared.extent,
        startTop: result.startTop,
        endTop: result.endTop,
      };
    } finally {
      await session.detach();
    }
  }

  return page.evaluate(async ({ durationMs, pixelsPerMs }) => {
    const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
    if (!canvas) throw new Error("The workspace canvas is missing.");
    const startBox = { clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight };
    const extent = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
    if (extent < 2_000) throw new Error("The workspace canvas is too short for this probe.");
    const base = extent * 0.25;
    canvas.scrollTop = base;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const startTop = canvas.scrollTop;
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const elapsed = Math.min(durationMs, Math.max(0, now - startedAt));
        canvas.scrollTop = base + elapsed * pixelsPerMs;
        if (now - startedAt < durationMs) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return {
      startBox,
      endBox: { clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight },
      extent,
      startTop,
      endTop: canvas.scrollTop,
    };
  }, { durationMs: DURATION_MS, pixelsPerMs: PIXELS_PER_MS });
}

export async function probeCanvasStyleSensitivity(
  page: Page,
  options: { candidate?: CanvasStyleSensitivityCandidate } = {},
): Promise<CanvasStyleSensitivityResult> {
  const candidate = options.candidate ?? "content-hidden";
  await expect(page.locator('.navigation-pane button.nav-row[data-nav-folder-kind="linked"]').first())
    .toBeVisible({ timeout: 60_000 });
  const initial = await readDomAndStyle(page);
  await waitForDecodedViewport(page, "initial viewport");
  if (initial.style.computedContentVisibility === "hidden") {
    throw new Error("The navigation pane is already content-hidden before the probe.");
  }

  const ensureBox = (box: Box) => {
    if (
      box.clientWidth !== initial.style.box.clientWidth ||
      box.clientHeight !== initial.style.box.clientHeight
    ) throw new Error("Navigation style changed canvas client dimensions; discard this probe.");
  };
  const restore = async () => {
    await page.evaluate((style) => {
      const nav = document.querySelector<HTMLElement>(".navigation-pane");
      if (!nav) throw new Error("The navigation pane is missing during style restore.");
      const restoreProperty = (name: string, value: string, priority: string) => {
        if (value === "") nav.style.removeProperty(name);
        else nav.style.setProperty(name, value, priority);
      };
      restoreProperty("content-visibility", style.contentVisibility, style.contentVisibilityPriority);
      restoreProperty("contain", style.contain, style.containPriority);
    }, initial.style);
    await twoFrames(page);
  };
  const hide = async () => page.evaluate(async () => {
    const nav = document.querySelector<HTMLElement>(".navigation-pane");
    const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
    if (!nav || !canvas) throw new Error("Required navigation or canvas surface is missing.");
    nav.style.contentVisibility = "hidden";
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      hidden: getComputedStyle(nav).contentVisibility === "hidden",
      box: { clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight },
    };
  });
  const containLayoutAndStyle = async () => page.evaluate(async () => {
    const nav = document.querySelector<HTMLElement>(".navigation-pane");
    const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
    if (!nav || !canvas) throw new Error("Required navigation or canvas surface is missing.");
    nav.style.setProperty("contain", "layout style");
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const computed = getComputedStyle(nav);
    const containTokens = computed.contain.split(/\s+/).filter(Boolean);
    const rect = nav.getBoundingClientRect();
    return {
      containsLayoutAndStyle: containTokens.includes("layout") && containTokens.includes("style"),
      visible: computed.display !== "none" && computed.visibility !== "hidden" &&
        computed.visibility !== "collapse" && computed.contentVisibility !== "hidden" &&
        rect.width > 0 && rect.height > 0,
      box: { clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight },
    };
  });
  const assertNavVisible = async (phase: Phase) => {
    const state = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>(".navigation-pane");
      const navScroll = nav?.querySelector<HTMLElement>(".navigation-scroll");
      if (!nav || !navScroll) throw new Error("The navigation pane is missing.");
      const computed = getComputedStyle(nav);
      const rect = nav.getBoundingClientRect();
      return {
        visible: computed.display !== "none" && computed.visibility !== "hidden" &&
          computed.visibility !== "collapse" && computed.contentVisibility !== "hidden" &&
          rect.width > 0 && rect.height > 0,
        geometry: {
          width: nav.clientWidth, height: nav.clientHeight,
          scrollWidth: navScroll.clientWidth, scrollHeight: navScroll.clientHeight,
          extent: navScroll.scrollHeight,
        },
      };
    });
    if (!state.visible) throw new Error("The navigation pane is not visible during " + phase + ".");
    for (const field of ["width", "height", "scrollWidth", "scrollHeight", "extent"] as const) {
      if (state.geometry[field] !== initial.style.navGeometry[field]) {
        throw new Error("The navigation style candidate changed navigation geometry; discard this probe.");
      }
    }
  };
  const measure = async (phase: Phase) => {
    if (candidate !== "content-hidden") await assertNavVisible(phase);
    await resetRendererCounters(page);
    const scroll = await scrollFromQuarterExtent(page);
    const renderer = await readRendererProbe(page);
    const visible = await waitForDecodedViewport(page, phase);
    ensureBox(scroll.startBox);
    ensureBox(scroll.endBox);
    if (scroll.endTop - scroll.startTop < 100) throw new Error("The canvas did not scroll far enough.");
    if (candidate !== "content-hidden") await assertNavVisible(phase);
    return {
      phase,
      scrollExtentPx: Math.round(scroll.extent),
      scrollTravelPx: Math.round(scroll.endTop - scroll.startTop),
      visibleImageCards: visible.imageCards,
      decodedVisibleImages: visible.decodedImages,
      visibleImageCoverage: Number(visible.coverage.toFixed(3)),
      renderer,
    };
  };

  const readRowsAutoFingerprint = async () => page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".navigation-pane");
    if (!nav) throw new Error("The navigation pane is missing.");
    const focusOrder = [...nav.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")]
      .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[inert]"))
      .map((element) => {
        // Keep identities private to this comparison. Equal tag names alone
        // cannot detect reordering of two folder buttons.
        const row = element.closest(".nav-tree-row")?.querySelector(".nav-row");
        const identity = element.getAttribute("data-nav-folder-id")
          ?? element.getAttribute("data-nav-collection-id")
          ?? row?.getAttribute("data-nav-folder-id")
          ?? row?.getAttribute("data-nav-collection-id")
          ?? "";
        return `${element.tagName}:${element.tabIndex}:${identity}:${element.className}`;
      })
      .join(",");
    return [
      // Canvas DOM and extent can change as real image dimensions arrive.
      // The invariant owned by this experiment is navigation DOM and order.
      nav.querySelectorAll("*").length,
      nav.querySelectorAll(".nav-tree-row:has(> .nav-row)").length,
      focusOrder,
    ].join("|");
  });
  const assertRowsAutoDomStable = async (fingerprint: string) => {
    if ((await readRowsAutoFingerprint()) !== fingerprint) {
      throw new Error("The rows-auto candidate changed navigation DOM or tab order.");
    }
  };
  const verifyRowsAutoApplied = async () => page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".navigation-pane");
    if (!nav) throw new Error("The navigation pane is missing.");
    const row = nav.querySelector<HTMLElement>(
      ".nav-tree-row:has(> .nav-row):not(:has(> .nav-inline-edit)):not(:focus-within):not([data-insert-edge])",
    );
    if (!row) throw new Error("No ordinary navigation tree row is available for the rows-auto check.");
    const computed = getComputedStyle(row);
    const expectedIntrinsic = `auto ${getComputedStyle(nav).getPropertyValue("--shell-control-height").trim()}`;
    return computed.contentVisibility === "auto" &&
      computed.getPropertyValue("contain-intrinsic-block-size").trim() === expectedIntrinsic;
  });
  const readDeferredRows = async (): Promise<number | null> => page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".navigation-pane");
    if (!nav) throw new Error("The navigation pane is missing.");
    const rows = [...nav.querySelectorAll<HTMLElement>(
      ".nav-tree-row:has(> .nav-row):not(:has(> .nav-inline-edit))",
    )] as Array<HTMLElement & {
      checkVisibility?: (options?: { contentVisibilityAuto?: boolean }) => boolean;
    }>;
    if (rows.length === 0) return 0;
    // The row's own box remains rendered while auto skips its contents.
    // Inspect the button inside that containment boundary instead.
    const buttons = rows.map((row) => row.querySelector<HTMLElement>(".nav-row"));
    if (!buttons[0] || typeof buttons[0].checkVisibility !== "function") return null;
    return buttons.filter((button) => button && !button.checkVisibility({ contentVisibilityAuto: true })).length;
  });

  const windows: CanvasStyleSensitivityResult["windows"] = [];
  let deferredNavigationRows: number | null = null;
  try {
    await resetRendererCounters(page);
    await scrollFromQuarterExtent(page);
    await waitForDecodedViewport(page, "warm-up route");
    windows.push(await measure("baseline-visible"));

    if (candidate === "content-hidden") {
      const hidden = await hide();
      if (!hidden.hidden) throw new Error("The navigation pane did not enter content-visibility hidden.");
      ensureBox(hidden.box);
      windows.push(await measure("nav-content-hidden"));

      await restore();
      const visibleBox = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
        if (!canvas) throw new Error("The workspace canvas is missing.");
        return { clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight };
      });
      ensureBox(visibleBox);
      windows.push(await measure("visible-again"));

      const hiddenAgain = await hide();
      if (!hiddenAgain.hidden) throw new Error("The navigation pane did not re-enter content-visibility hidden.");
      ensureBox(hiddenAgain.box);
      windows.push(await measure("hidden-again"));
    } else if (candidate === "layout-containment") {
      const contained = await containLayoutAndStyle();
      if (!contained.containsLayoutAndStyle) {
        throw new Error("The computed navigation containment does not include layout and style.");
      }
      if (!contained.visible) throw new Error("The navigation pane became hidden under layout containment.");
      ensureBox(contained.box);
      windows.push(await measure("nav-layout-contained"));

      await restore();
      const visibleBox = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
        if (!canvas) throw new Error("The workspace canvas is missing.");
        return { clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight };
      });
      ensureBox(visibleBox);
      await assertNavVisible("visible-again");
      windows.push(await measure("visible-again"));

      const containedAgain = await containLayoutAndStyle();
      if (!containedAgain.containsLayoutAndStyle) {
        throw new Error("The computed navigation containment does not include layout and style.");
      }
      if (!containedAgain.visible) throw new Error("The navigation pane became hidden under layout containment.");
      ensureBox(containedAgain.box);
      windows.push(await measure("contained-again"));
    } else {
      const controlHeight = Number.parseFloat(initial.style.shellControlHeight);
      const rowHeight = Number.parseFloat(initial.style.navRowHeight);
      const disclosureHeight = Number.parseFloat(initial.style.navDisclosureHeight);
      if (
        !Number.isFinite(controlHeight) ||
        !Number.isFinite(rowHeight) ||
        !Number.isFinite(disclosureHeight) ||
        Math.abs(rowHeight - controlHeight) > 0.5 ||
        disclosureHeight > rowHeight
      ) throw new Error("The navigation row height no longer matches its control token or the disclosure height.");

      const marker = "data-e2e-nav-rows-auto-probe";
      const token = "serpent-probe";
      const styleId = "serpent-e2e-nav-rows-auto-probe-style";
      const rowsAutoFingerprint = await readRowsAutoFingerprint();
      const installRowsAuto = async () => page.evaluate(({ markerName, markerToken, ownedStyleId }) => {
        const nav = document.querySelector<HTMLElement>(".navigation-pane");
        if (!nav) throw new Error("The navigation pane is missing.");
        if (document.querySelector(`[${markerName}]`) || document.getElementById(ownedStyleId)) {
          throw new Error("The rows-auto probe marker or style node already exists; refusing to replace it.");
        }
        const style = document.createElement("style");
        style.id = ownedStyleId;
        style.setAttribute("data-e2e-rows-auto-owned-style", markerToken);
        style.textContent = `
          .navigation-pane[${markerName}="${markerToken}"] .nav-tree-row:has(> .nav-row):not(:has(> .nav-inline-edit)) {
            content-visibility: auto;
            contain-intrinsic-block-size: auto var(--shell-control-height);
          }
          .navigation-pane[${markerName}="${markerToken}"] .nav-tree-row:has(> .nav-row):not(:has(> .nav-inline-edit)):is(:focus-within, [data-insert-edge]) {
            content-visibility: visible;
          }
        `;
        try {
          document.head.append(style);
          nav.setAttribute(markerName, markerToken);
        } catch (error) {
          style.remove();
          nav.removeAttribute(markerName);
          throw error;
        }
        return true;
      }, { markerName: marker, markerToken: token, ownedStyleId: styleId });
      const removeRowsAuto = async () => {
        const result = await page.evaluate(({ markerName, markerToken, ownedStyleId }) => {
          const nav = document.querySelector<HTMLElement>(".navigation-pane");
          if (!nav) throw new Error("The navigation pane is missing during rows-auto cleanup.");
          const style = document.getElementById(ownedStyleId);
          if (style && style.getAttribute("data-e2e-rows-auto-owned-style") !== markerToken) {
            throw new Error("The rows-auto style node ownership changed; refusing to remove it.");
          }
          if (nav.hasAttribute(markerName) && nav.getAttribute(markerName) !== markerToken) {
            throw new Error("The navigation rows-auto marker ownership changed; refusing to remove it.");
          }
          style?.remove();
          if (nav.getAttribute(markerName) === markerToken) nav.removeAttribute(markerName);
          return !style?.isConnected && !nav.hasAttribute(markerName) && !document.getElementById(ownedStyleId);
        }, { markerName: marker, markerToken: token, ownedStyleId: styleId });
        if (!result) throw new Error("The rows-auto probe left a temporary marker or style node behind.");
      };
      let rowsAutoInstalled = false;
      try {
        await installRowsAuto();
        rowsAutoInstalled = true;
        if (!(await verifyRowsAutoApplied())) {
          throw new Error("The rows-auto rule did not preserve the row height token as its intrinsic size.");
        }
        await assertNavVisible("nav-rows-auto");
        windows.push(await measure("nav-rows-auto"));
        await assertRowsAutoDomStable(rowsAutoFingerprint);

        await removeRowsAuto();
        rowsAutoInstalled = false;
        await assertNavVisible("visible-again");
        windows.push(await measure("visible-again"));
        await assertRowsAutoDomStable(rowsAutoFingerprint);

        await installRowsAuto();
        rowsAutoInstalled = true;
        if (!(await verifyRowsAutoApplied())) {
          throw new Error("The repeated rows-auto rule did not preserve the row height token as its intrinsic size.");
        }
        await assertNavVisible("rows-auto-again");
        windows.push(await measure("rows-auto-again"));
        await assertRowsAutoDomStable(rowsAutoFingerprint);
        deferredNavigationRows = await readDeferredRows();
      } finally {
        if (rowsAutoInstalled) await removeRowsAuto();
      }
    }
  } finally {
    await restore();
  }

  return {
    scope: "isolated-catalog-diagnostic",
    candidate,
    input: process.env.SERPENT_REAL_NAV_NATIVE_SCROLL === "1"
      ? "native-mouse-wheel"
      : "programmatic-scroll",
    counterWindow: process.env.SERPENT_REAL_NAV_NATIVE_SCROLL === "1"
      ? "native-wheel-only"
      : "quarter-reset-and-scroll",
    hasCpuProfilerOrTrace: false,
    notFinalOrdinaryAb: true,
    dom: initial.dom,
    canvasDimensionsUnchanged: true,
    deferredNavigationRows,
    windows,
  };
}
