import { expect, type Locator, type Page } from "@playwright/test";
import type { SerpentLibraryApi } from "../../src/shared/library-api";
import { MANAGED_FOLDERS_DRAG_TYPE } from "../../src/renderer/folder-drag-drop";
import { visibleImageStats, type VisibleImageStats } from "./perf-bench-helpers";

const LINKED_ROW_SELECTOR =
  '.navigation-pane button.nav-row[data-nav-folder-kind="linked"]';
const ALL_ASSETS_LABEL = "所有资产";
const ADD_FOLDER_LABEL = "添加文件夹";
const LINKED_ROW_MINIMUM = 100;
const PHASE_TIMEOUT_MS = 60_000;

type ScrollState = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  canvasScrollTop: number | null;
  canvasRect: { top: number; left: number; width: number; height: number } | null;
};

type RowViewportState = {
  contentVisibility: string;
  inNavViewport: boolean;
  navScrollTop: number;
  navScrollHeight: number;
  navClientHeight: number;
};

type InsertEdgeResult = {
  dragStarted: boolean;
  hasManagedFolderMime: boolean;
  dragOverAccepted: boolean;
  contentVisibility: string;
  lineHeight: number;
  lineWithinRow: boolean;
  navScrollHeight: number;
};

export type RealSidebarRenderingResult = {
  linkedRows: number;
  focus: {
    naturalScrollIntoView: boolean;
    focusedRowVisible: boolean;
    tabReachedFollowingRow: boolean;
    shiftTabReturned: boolean;
    focusedContentVisibility: string;
    mainCanvasStable: boolean;
    navExtentStable: boolean;
    navScrollTop: number;
  };
  offscreen: {
    domRowsRetained: boolean;
    nonFocusedContentVisibility: string;
    checkVisibilitySupported: boolean;
    offscreenAutoRowsChecked: number | null;
    autoSkippedRows: number | null;
    middleScrollLegal: boolean;
    endScrollLegal: boolean;
    navExtentStable: boolean;
  };
  editor: {
    cancelPreservedName: boolean;
    submitChangedName: boolean;
    editorContentVisibility: string;
    editorRowContentVisibility: string;
    rowNavigationWorks: boolean;
  };
  insertion: {
    customModeSelected: boolean;
    before: Pick<InsertEdgeResult,
      "dragStarted" | "hasManagedFolderMime" | "dragOverAccepted" |
      "contentVisibility" | "lineHeight" | "lineWithinRow">;
    after: Pick<InsertEdgeResult,
      "dragStarted" | "hasManagedFolderMime" | "dragOverAccepted" |
      "contentVisibility" | "lineHeight" | "lineWithinRow">;
    navExtentStable: boolean;
  };
  decodedImages: Pick<VisibleImageStats,
    "visibleCards" | "imageCards" | "decodedImages" | "coverage">;
  elapsedMs: number;
};

/**
 * Checks real linked-row focus/visibility behavior and managed-row interactions.
 * The linked source is only read; test folder mutations stay inside the isolated
 * catalog. Durations are automation wall-clock bounds, not renderer timings.
 */
export async function probeRealSidebarRendering(
  page: Page,
  libraryId: string,
): Promise<RealSidebarRenderingResult> {
  const startedAt = Date.now();
  const apiLinkedRows = await page.evaluate(async (targetLibraryId) => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const listed = await api.listLinkedFolders({ libraryId: targetLibraryId });
    if (!listed.ok) throw new Error("Could not read linked directory summaries.");
    return listed.value.length;
  }, libraryId);
  expect(apiLinkedRows).toBeGreaterThan(LINKED_ROW_MINIMUM);

  const nav = page.locator(".navigation-scroll");
  const linkedRows = page.locator(LINKED_ROW_SELECTOR);
  await expect(nav).toBeVisible({ timeout: PHASE_TIMEOUT_MS });
  await expect.poll(() => linkedRows.count(), {
    timeout: PHASE_TIMEOUT_MS,
    message: "The linked directory tree must expose more than one hundred rows.",
  }).toBeGreaterThan(LINKED_ROW_MINIMUM);
  const linkedRowCount = await linkedRows.count();
  expect(linkedRowCount).toBeGreaterThan(LINKED_ROW_MINIMUM);

  const initialDomRows = await linkedRows.count();
  await nav.evaluate((element) => {
    element.scrollTop = 0;
  });
  const beforeFocus = await nav.evaluate(readScrollState);
  expect(beforeFocus.canvasRect).not.toBeNull();
  const focusIndex = linkedRowCount - 2;
  const focusedRow = linkedRows.nth(focusIndex);
  const followingRow = linkedRows.nth(focusIndex + 1);
  await focusedRow.focus();
  await expect(focusedRow).toBeFocused({ timeout: PHASE_TIMEOUT_MS });
  const focusedViewport = await readRowViewportState(focusedRow);
  const afterFocus = await nav.evaluate(readScrollState);
  const naturalScrollIntoView = afterFocus.scrollTop > beforeFocus.scrollTop;
  const focusedRowVisible = focusedViewport.inNavViewport;
  const mainCanvasStable =
    beforeFocus.canvasScrollTop === afterFocus.canvasScrollTop &&
    sameCanvasRect(beforeFocus.canvasRect, afterFocus.canvasRect);
  const navExtentStable =
    Math.abs(beforeFocus.scrollHeight - afterFocus.scrollHeight) <= 1;
  expect(naturalScrollIntoView).toBe(true);
  expect(focusedRowVisible).toBe(true);
  expect(mainCanvasStable).toBe(true);
  expect(navExtentStable).toBe(true);

  await page.keyboard.press("Tab");
  const tabReachedFollowingRow = await followingRow.evaluate((row) => {
    const rowContainer = row.closest(".nav-tree-row");
    return rowContainer?.contains(document.activeElement) === true;
  });
  expect(tabReachedFollowingRow).toBe(true);
  await page.keyboard.press("Shift+Tab");
  const shiftTabReturned = await focusedRow.evaluate(
    (row) => document.activeElement === row,
  );
  expect(shiftTabReturned).toBe(true);
  const focusedAfterKeyboard = await readRowViewportState(focusedRow);
  expect(focusedAfterKeyboard.inNavViewport).toBe(true);
  expect(focusedAfterKeyboard.contentVisibility).toBe("visible");

  const offscreenState = await nav.evaluate((navElement, rowSelector) => {
    const rows = [...document.querySelectorAll<HTMLButtonElement>(rowSelector)];
    const navRect = navElement.getBoundingClientRect();
    const firstRow = rows[0];
    const firstContainer = firstRow?.closest<HTMLElement>(".nav-tree-row") ?? null;
    let checkVisibilitySupported =
      typeof Element.prototype.checkVisibility === "function";
    let offscreenAutoRowsChecked = 0;
    let autoSkippedRows = 0;
    let firstNonFocusedContentVisibility = "missing";
    for (const row of rows) {
      const container = row.closest<HTMLElement>(".nav-tree-row");
      if (!container) continue;
      const contentVisibility = getComputedStyle(container).contentVisibility;
      if (row === firstRow) firstNonFocusedContentVisibility = contentVisibility;
      if (container.contains(document.activeElement)) continue;
      const rect = container.getBoundingClientRect();
      const outsideNav =
        rect.bottom <= navRect.top || rect.top >= navRect.bottom;
      if (!outsideNav || contentVisibility !== "auto") continue;
      if (!checkVisibilitySupported) continue;
      try {
        offscreenAutoRowsChecked += 1;
        // The auto container keeps its own box visible. Test the row button
        // inside it to detect whether descendants are still skipped.
        if (!row.checkVisibility({ contentVisibilityAuto: true })) {
          autoSkippedRows += 1;
        }
      } catch {
        checkVisibilitySupported = false;
        offscreenAutoRowsChecked = 0;
        autoSkippedRows = 0;
      }
    }
    const firstRect = firstContainer?.getBoundingClientRect();
    const firstOffscreen = firstRect
      ? firstRect.bottom <= navRect.top || firstRect.top >= navRect.bottom
      : false;
    return {
      rowCount: rows.length,
      firstNonFocusedContentVisibility,
      firstOffscreen,
      checkVisibilitySupported,
      offscreenAutoRowsChecked,
      autoSkippedRows,
    };
  }, LINKED_ROW_SELECTOR);
  const domRowsRetained = offscreenState.rowCount === initialDomRows;
  expect(domRowsRetained).toBe(true);
  expect(offscreenState.firstOffscreen).toBe(true);
  expect(offscreenState.firstNonFocusedContentVisibility).toBe("auto");
  if (offscreenState.checkVisibilitySupported) {
    expect(offscreenState.offscreenAutoRowsChecked).toBeGreaterThan(0);
    expect(offscreenState.autoSkippedRows).toBeGreaterThan(0);
  }

  const middleRow = linkedRows.nth(Math.floor(linkedRowCount / 2));
  await middleRow.evaluate((row) => {
    row.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "auto",
    });
  });
  await expect.poll(
    async () => (await readRowViewportState(middleRow)).inNavViewport,
    { timeout: 5_000 },
  ).toBe(true);
  const middleScroll = await readRowViewportState(middleRow);
  const middleScrollLegal = isLegalScroll(
    middleScroll.navScrollTop,
    middleScroll.navScrollHeight,
    middleScroll.navClientHeight,
  ) && middleScroll.inNavViewport;
  expect(middleScrollLegal).toBe(true);

  const lastRow = linkedRows.nth(linkedRowCount - 1);
  await lastRow.evaluate((row) => {
    row.scrollIntoView({
      block: "end",
      inline: "nearest",
      behavior: "auto",
    });
  });
  await expect.poll(
    async () => (await readRowViewportState(lastRow)).inNavViewport,
    { timeout: 5_000 },
  ).toBe(true);
  const endScroll = await readRowViewportState(lastRow);
  const endScrollLegal = isLegalScroll(
    endScroll.navScrollTop,
    endScroll.navScrollHeight,
    endScroll.navClientHeight,
  ) && endScroll.inNavViewport;
  expect(endScrollLegal).toBe(true);
  const extentAfterScroll = Math.abs(
    beforeFocus.scrollHeight - endScroll.navScrollHeight,
  ) <= 1;
  expect(extentAfterScroll).toBe(true);

  await page.getByRole("button", { name: ALL_ASSETS_LABEL, exact: true }).click();
  const firstFolderName = "Sidebar Probe Alpha";
  const renamedFolderName = "Sidebar Probe Alpha Renamed";
  const secondFolderName = "Sidebar Probe Beta";
  await createManagedFolder(page, firstFolderName);
  const firstFolderRow = managedFolderRow(page, firstFolderName);
  await firstFolderRow.click();
  await page.keyboard.press("F2");
  const editInput = page.locator(".nav-inline-edit input");
  await expect(editInput).toBeVisible({ timeout: PHASE_TIMEOUT_MS });
  await editInput.fill("Sidebar Probe Cancelled");
  await editInput.press("Escape");
  await expect(page.locator(".nav-inline-edit")).toHaveCount(0, {
    timeout: PHASE_TIMEOUT_MS,
  });
  const cancelPreservedName = await managedFolderRow(page, firstFolderName)
    .locator(".nav-row-label").textContent() === firstFolderName;
  expect(cancelPreservedName).toBe(true);

  await managedFolderRow(page, firstFolderName).click();
  await page.keyboard.press("F2");
  await expect(editInput).toBeVisible({ timeout: PHASE_TIMEOUT_MS });
  const editorRow = page.locator(".nav-inline-edit");
  const editorVisibility = await editorRow.evaluate((editor) => {
    const row = editor.closest<HTMLElement>(".nav-tree-row");
    return {
      editor: getComputedStyle(editor).contentVisibility,
      row: row ? getComputedStyle(row).contentVisibility : "missing",
      checkVisible:
        typeof editor.checkVisibility === "function"
          ? editor.checkVisibility({ contentVisibilityAuto: true })
          : null,
    };
  });
  expect(editorVisibility.editor).toBe("visible");
  expect(editorVisibility.row).toBe("visible");
  if (editorVisibility.checkVisible !== null) {
    expect(editorVisibility.checkVisible).toBe(true);
  }
  await editInput.fill(renamedFolderName);
  await editInput.press("Enter");
  await expect(page.locator(".nav-inline-edit")).toHaveCount(0, {
    timeout: PHASE_TIMEOUT_MS,
  });
  const renamedRow = managedFolderRow(page, renamedFolderName);
  await expect(renamedRow).toBeVisible({ timeout: PHASE_TIMEOUT_MS });
  const submitChangedName =
    await renamedRow.locator(".nav-row-label").textContent() === renamedFolderName;
  expect(submitChangedName).toBe(true);
  await renamedRow.click();
  await expect(page.locator(".scope-crumb-label.is-current")).toHaveText(
    renamedFolderName,
    { timeout: PHASE_TIMEOUT_MS },
  );
  const rowNavigationWorks = true;

  await page.getByRole("button", { name: ALL_ASSETS_LABEL, exact: true }).click();
  await createManagedFolder(page, secondFolderName);
  const sortTrigger = page.getByRole("button", {
    name: "排序文件夹",
    exact: true,
  });
  await sortTrigger.click();
  await page.getByRole("option", { name: "按字母", exact: true }).click();
  await sortTrigger.click();
  const customOption = page.getByRole("option", {
    name: "自定义",
    exact: true,
  });
  await customOption.click();
  await sortTrigger.click();
  await expect(customOption).toHaveAttribute("aria-selected", "true", {
    timeout: PHASE_TIMEOUT_MS,
  });
  await page.keyboard.press("Escape");
  const customModeSelected = true;

  const sourceRow = managedFolderRow(page, renamedFolderName);
  const targetRow = managedFolderRow(page, secondFolderName);
  await sourceRow.evaluate((row) => row.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: "auto",
  }));
  await targetRow.evaluate((row) => row.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: "auto",
  }));
  await expect.poll(
    async () => (await readRowViewportState(sourceRow)).inNavViewport
      && (await readRowViewportState(targetRow)).inNavViewport,
    { timeout: 5_000 },
  ).toBe(true);
  const sourceId = await sourceRow.getAttribute("data-nav-folder-id");
  const targetId = await targetRow.getAttribute("data-nav-folder-id");
  if (!sourceId || !targetId) throw new Error("Managed probe rows lack navigation identities.");
  const navExtentBeforeInsert = await nav.evaluate((element) => element.scrollHeight);
  const before = await probeInsertEdge(page, sourceId, targetId, "before");
  const after = await probeInsertEdge(page, sourceId, targetId, "after");
  const navExtentAfterInsert = await nav.evaluate((element) => element.scrollHeight);
  const insertionNavExtentStable =
    Math.abs(navExtentBeforeInsert - navExtentAfterInsert) <= 1 &&
    Math.abs(navExtentBeforeInsert - before.navScrollHeight) <= 1 &&
    Math.abs(navExtentBeforeInsert - after.navScrollHeight) <= 1;

  await page.getByRole("button", { name: ALL_ASSETS_LABEL, exact: true }).click();
  await expect.poll(async () => (await visibleImageStats(page)).coverage, {
    timeout: PHASE_TIMEOUT_MS,
    message: "The final all-assets viewport must have at least ninety percent decoded images.",
  }).toBeGreaterThanOrEqual(0.9);
  const images = await visibleImageStats(page);
  expect(images.imageCards).toBeGreaterThan(0);
  expect(images.decodedImages).toBeGreaterThan(0);

  const result: RealSidebarRenderingResult = {
    linkedRows: linkedRowCount,
    focus: {
      naturalScrollIntoView,
      focusedRowVisible,
      tabReachedFollowingRow,
      shiftTabReturned,
      focusedContentVisibility: focusedAfterKeyboard.contentVisibility,
      mainCanvasStable,
      navExtentStable,
      navScrollTop: Number(afterFocus.scrollTop.toFixed(1)),
    },
    offscreen: {
      domRowsRetained,
      nonFocusedContentVisibility: offscreenState.firstNonFocusedContentVisibility,
      checkVisibilitySupported: offscreenState.checkVisibilitySupported,
      offscreenAutoRowsChecked: offscreenState.checkVisibilitySupported
        ? offscreenState.offscreenAutoRowsChecked
        : null,
      autoSkippedRows: offscreenState.checkVisibilitySupported
        ? offscreenState.autoSkippedRows
        : null,
      middleScrollLegal,
      endScrollLegal,
      navExtentStable: extentAfterScroll,
    },
    editor: {
      cancelPreservedName,
      submitChangedName,
      editorContentVisibility: editorVisibility.editor,
      editorRowContentVisibility: editorVisibility.row,
      rowNavigationWorks,
    },
    insertion: {
      customModeSelected,
      before,
      after,
      navExtentStable: insertionNavExtentStable,
    },
    decodedImages: {
      visibleCards: images.visibleCards,
      imageCards: images.imageCards,
      decodedImages: images.decodedImages,
      coverage: Number(images.coverage.toFixed(3)),
    },
    elapsedMs: Date.now() - startedAt,
  };
  expect(result.insertion.before.dragStarted).toBe(true);
  expect(result.insertion.before.hasManagedFolderMime).toBe(true);
  expect(result.insertion.before.dragOverAccepted).toBe(true);
  expect(result.insertion.before.contentVisibility).toBe("visible");
  expect(result.insertion.before.lineHeight).toBeGreaterThan(0);
  expect(result.insertion.before.lineWithinRow).toBe(true);
  expect(result.insertion.after.dragStarted).toBe(true);
  expect(result.insertion.after.hasManagedFolderMime).toBe(true);
  expect(result.insertion.after.dragOverAccepted).toBe(true);
  expect(result.insertion.after.contentVisibility).toBe("visible");
  expect(result.insertion.after.lineHeight).toBeGreaterThan(0);
  expect(result.insertion.after.lineWithinRow).toBe(true);
  expect(result.insertion.navExtentStable).toBe(true);
  return result;
}

async function createManagedFolder(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: ADD_FOLDER_LABEL, exact: true }).click();
  const input = page.locator(".nav-inline-edit input");
  await expect(input).toBeVisible({ timeout: PHASE_TIMEOUT_MS });
  await input.fill(name);
  await input.press("Enter");
  await expect(managedFolderRow(page, name)).toBeVisible({
    timeout: PHASE_TIMEOUT_MS,
  });
}

function managedFolderRow(page: Page, name: string): Locator {
  const label = page
    .locator(".navigation-pane .nav-row-label")
    .getByText(name, { exact: true });
  return label.locator(
    'xpath=ancestor::button[contains(@class, "nav-row") and @data-nav-folder-kind="managed"]',
  );
}

async function readRowViewportState(row: Locator): Promise<RowViewportState> {
  return row.evaluate((element) => {
    const nav = element.closest(".navigation-scroll") as HTMLElement | null;
    const container = element.closest<HTMLElement>(".nav-tree-row");
    if (!nav || !container) {
      return {
        contentVisibility: "missing",
        inNavViewport: false,
        navScrollTop: 0,
        navScrollHeight: 0,
        navClientHeight: 0,
      };
    }
    const rowRect = container.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    return {
      contentVisibility: getComputedStyle(container).contentVisibility,
      inNavViewport:
        rowRect.bottom > navRect.top &&
        rowRect.top < navRect.bottom &&
        rowRect.left < navRect.right &&
        rowRect.right > navRect.left,
      navScrollTop: nav.scrollTop,
      navScrollHeight: nav.scrollHeight,
      navClientHeight: nav.clientHeight,
    };
  });
}

function readScrollState(element: Element): ScrollState {
  const scrollElement = element as HTMLElement;
  const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
  const rect = canvas?.getBoundingClientRect();
  return {
    scrollTop: scrollElement.scrollTop,
    scrollHeight: scrollElement.scrollHeight,
    clientHeight: scrollElement.clientHeight,
    canvasScrollTop: canvas?.scrollTop ?? null,
    canvasRect: rect
      ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
      : null,
  };
}

function sameCanvasRect(
  left: ScrollState["canvasRect"],
  right: ScrollState["canvasRect"],
): boolean {
  if (!left || !right) return left === right;
  return (
    Math.abs(left.top - right.top) <= 1 &&
    Math.abs(left.left - right.left) <= 1 &&
    Math.abs(left.width - right.width) <= 1 &&
    Math.abs(left.height - right.height) <= 1
  );
}

function isLegalScroll(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  return scrollTop >= -1 && scrollTop <= maxScrollTop + 1;
}

async function probeInsertEdge(
  page: Page,
  sourceId: string,
  targetId: string,
  edge: "before" | "after",
): Promise<InsertEdgeResult> {
  const dragResult = await page.evaluate(({ sourceId, targetId, mimeType, edge }) => {
    const rows = [...document.querySelectorAll<HTMLButtonElement>(
      ".navigation-pane button.nav-row[data-nav-folder-id]",
    )];
    const source = rows.find((row) => row.getAttribute("data-nav-folder-id") === sourceId);
    const target = rows.find((row) => row.getAttribute("data-nav-folder-id") === targetId);
    if (!source || !target) {
      return { dragStarted: false, hasManagedFolderMime: false, dragOverAccepted: false };
    }
    const transfer = new DataTransfer();
    const dragStarted = source.dispatchEvent(new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
    const rect = target.getBoundingClientRect();
    const clientY = edge === "before"
      ? rect.top + rect.height * 0.1
      : rect.top + rect.height * 0.9;
    target.dispatchEvent(new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
      clientY,
      dataTransfer: transfer,
    }));
    const dragOver = new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      clientY,
      dataTransfer: transfer,
    });
    target.dispatchEvent(dragOver);
    return {
      dragStarted,
      hasManagedFolderMime: transfer.types.includes(mimeType),
      dragOverAccepted: dragOver.defaultPrevented,
    };
  }, {
    sourceId,
    targetId,
    mimeType: MANAGED_FOLDERS_DRAG_TYPE,
    edge,
  });
  let lineState: Omit<InsertEdgeResult,
    "dragStarted" | "hasManagedFolderMime" | "dragOverAccepted">;
  try {
    if (!dragResult.dragStarted || !dragResult.hasManagedFolderMime) {
      throw new Error("The managed folder drag did not expose its expected payload.");
    }
    const targetContainer = page.locator(
      ".navigation-pane .nav-tree-row[data-insert-edge]",
    );
    await expect(targetContainer).toHaveAttribute("data-insert-edge", edge, {
      timeout: 5_000,
    });
    lineState = await targetContainer.evaluate((container) => {
      const line = container.querySelector<HTMLElement>(".nav-folder-insert-line");
      const rowRect = container.getBoundingClientRect();
      const lineRect = line?.getBoundingClientRect();
      const nav = container.closest<HTMLElement>(".navigation-scroll");
      return {
        contentVisibility: getComputedStyle(container).contentVisibility,
        lineHeight: lineRect?.height ?? 0,
        lineWithinRow: Boolean(
          lineRect &&
          lineRect.height > 0 &&
          lineRect.top >= rowRect.top - 2 &&
          lineRect.bottom <= rowRect.bottom + 2,
        ),
        navScrollHeight: nav?.scrollHeight ?? 0,
      };
    });
  } finally {
    await page.evaluate(({ sourceId, targetId }) => {
      const rows = [...document.querySelectorAll<HTMLButtonElement>(
        ".navigation-pane button.nav-row[data-nav-folder-id]",
      )];
      const source = rows.find((row) => row.getAttribute("data-nav-folder-id") === sourceId);
      const target = rows.find((row) => row.getAttribute("data-nav-folder-id") === targetId);
      const transfer = new DataTransfer();
      target?.dispatchEvent(new DragEvent("dragleave", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        relatedTarget: null,
      }));
      source?.dispatchEvent(new DragEvent("dragend", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    }, { sourceId, targetId });
  }
  await expect(page.locator(
    ".navigation-pane .nav-tree-row[data-insert-edge]",
  )).toHaveCount(0, { timeout: 5_000 });
  if (!lineState) throw new Error("The insertion line was not measured.");
  return { ...dragResult, ...lineState };
}
