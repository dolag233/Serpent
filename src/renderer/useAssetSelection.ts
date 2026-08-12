import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetSummary } from "../shared/asset-types";
import {
  buildBrowseSelectionOrder,
  resolveShiftBrowseRange,
  type BrowseSelectionAnchor,
} from "./browse-selection-order";
import { resolveFolderCardClickIntent } from "./folder-card-click";
import {
  canvasViewportFromMetrics,
  clientPointToContent,
  clipRectToViewport,
  contentRectFromPoints,
  contentRectToViewport,
  rectsIntersect,
  type MarqueeRect,
  viewportRectToContent,
} from "./marquee-geometry";
import { computeMarqueeSelection, isMarqueeAdditive } from "./marquee-selection";
import { resolveMasonryCenterRange } from "./masonry-selection-range";
import {
  isToggleSelectionModifier,
  resolveSelectionPlatform,
} from "./selection-modifiers";

export interface UseAssetSelectionParams {
  /** Visible asset summaries, used for Shift+click range computation */
  assets: AssetSummary[];
  /** Currently selected asset IDs */
  selectedAssetIds: string[];
  /** Setter for multi-select */
  setSelectedAssetIds: React.Dispatch<React.SetStateAction<string[]>>;
  /** Setter for single-select (preview target) */
  setSelectedAssetId: React.Dispatch<React.SetStateAction<string | undefined>>;
  /** When non-null, marquee drag is suppressed (preview is open) */
  previewAsset: AssetSummary | null;
  /** When non-null, marquee drag is suppressed (member is being dragged) */
  draggedMemberId: string | null;
  /** When non-null, marquee drag is suppressed (collection is being dragged) */
  draggedCollectionId: string | null;
  /** Ref to the scrollable workspace canvas element */
  workspaceCanvasRef: React.RefObject<HTMLDivElement | null>;
  /** Serpent-wgl2: the always-mounted marquee box div, mutated directly via ref. */
  marqueeBoxRef: React.RefObject<HTMLDivElement | null>;
  /** Visible folder-card ids (REQ-FOLDER-010), used for Shift+click range and marquee. */
  folderIds?: string[];
  /**
   * Optional asset id order for Shift/marquee (Serpent-oz1t). When omitted,
   * uses `assets` array order. Masonry passes visual reading order here.
   */
  selectionAssetIds?: string[];
  /** Use center-point rectangle semantics for Shift+click in masonry. */
  masonryShiftSelection?: boolean;
  /** Currently selected folder-card IDs */
  selectedFolderIds?: string[];
  /** Setter for folder multi-select */
  setSelectedFolderIds?: React.Dispatch<React.SetStateAction<string[]>>;
  /** Invoked after selection is cleared (blank click / Esc). */
  onSelectionCleared?: () => void;
}

export interface UseAssetSelectionReturn {
  /** Attach to the canvas element's onMouseDown */
  handleCanvasMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Clear all selection state (Esc, empty-canvas click, etc.) — also clears folder selection. */
  clearAssetSelection: (options?: { preserveFolders?: boolean }) => void;
  /** Ref for the selection anchor used by Shift+click range extension.
   *  Prefer `setAssetSelectionAnchor` for writes; the ref remains exposed for
   *  read access and legacy call sites. */
  selectionAnchorRef: React.MutableRefObject<string | null>;
  /** Single write entry point for the asset selection anchor (session restore,
   *  import reveal, select-all, invert-selection). */
  setAssetSelectionAnchor: (assetId: string | null) => void;
  /** Same as `selectionAnchorRef`, but for folder-card Shift+click ranges. */
  folderSelectionAnchorRef: React.MutableRefObject<string | null>;
  /** Attach to individual asset cards: onMouseDown sets the button, onClick calls this */
  handleCardClick: (assetId: string, event: React.MouseEvent) => void;
  /**
   * Attach to folder cards' onClick. Plain click selects (Serpent-829);
   * Cmd/Ctrl toggles; Shift extends a range. Entering the folder is
   * `onDoubleClick` in the caller — this handler never navigates.
   */
  handleFolderCardClick: (folderId: string, event: React.MouseEvent) => void;
  /** Ref that must be set in the card's onMouseDown: `cardMouseDownRef.current = e.button` */
  cardMouseDownRef: React.MutableRefObject<number>;
  /** Derived Set<string> for O(1) selection membership checks */
  selectedIdSet: Set<string>;
}

export function useAssetSelection({
  assets,
  selectedAssetIds,
  setSelectedAssetIds,
  setSelectedAssetId,
  previewAsset,
  draggedMemberId,
  draggedCollectionId,
  workspaceCanvasRef,
  marqueeBoxRef,
  folderIds = [],
  selectionAssetIds,
  masonryShiftSelection = false,
  selectedFolderIds = [],
  setSelectedFolderIds,
  onSelectionCleared,
}: UseAssetSelectionParams): UseAssetSelectionReturn {
  const selectionPlatform = useMemo(
    () => resolveSelectionPlatform(navigator.userAgent),
    [],
  );

  // ── Derived ────────────────────────────────────────────────────────────
  const selectedIdSet = useMemo(
    () => new Set(selectedAssetIds),
    [selectedAssetIds],
  );

  // ── Selection anchor (Shift+click range extension) ─────────────────────
  const selectionAnchorRef = useRef<string | null>(null);
  const folderSelectionAnchorRef = useRef<string | null>(null);
  const browseSelectionAnchorRef = useRef<BrowseSelectionAnchor | null>(null);

  /**
   * Single write entry point for the asset selection anchor. Session restore,
   * import reveal, select-all and invert-selection all update the anchor here
   * so the browse-order anchor fallback (selection-anchor.ts) can be wired in
   * one place instead of hunting direct `selectionAnchorRef.current` writes.
   */
  const setAssetSelectionAnchor = useCallback((assetId: string | null) => {
    selectionAnchorRef.current = assetId;
  }, []);

  // ── Card click button guard ────────────────────────────────────────────
  const cardMouseDownRef = useRef<number>(0);

  // ── Marquee state ──────────────────────────────────────────────────────
  const marqueeStartRef = useRef({ x: 0, y: 0 });
  const marqueeStartContentRef = useRef({ x: 0, y: 0 });
  const marqueePointerClientRef = useRef({ x: 0, y: 0 });
  const marqueeHitIdsRef = useRef<string[]>([]);
  const marqueeInitialSelectionRef = useRef<string[]>([]);
  const marqueeFolderHitIdsRef = useRef<string[]>([]);
  const marqueeInitialFolderSelectionRef = useRef<string[]>([]);
  const marqueeActiveRef = useRef(false);
  const autoScrollRef = useRef<{ direction: number; speed: number }>({ direction: 0, speed: 0 });
  const autoScrollRafRef = useRef<number | null>(null);
  const marqueeModifiersRef = useRef<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>({ metaKey: false, ctrlKey: false, shiftKey: false });
  // Serpent-wgl2: the marquee must not run per pointermove (~120Hz) — the
  // per-card getBoundingClientRect reads force a layout pass every frame.
  // Pointer coordinates are parked in a ref and the marquee (box update +
  // hit scan + selection diff) runs once per animation frame instead.
  const marqueeRafRef = useRef<number | null>(null);
  // Card rectangles are cached in canvas-content coordinates, which do not
  // change while scrolling; the cache is dropped whenever the canvas layout
  // size changes (resize / column reflow). Only cache misses read DOM.
  const marqueeCardRectsRef = useRef(new Map<string, MarqueeRect>());
  const marqueeCacheLayoutSigRef = useRef('');
  // The selection arrays are only pushed to React when the hit set actually
  // changes — most frames move the box without crossing a new card.
  const marqueeLastHitsKeyRef = useRef('');

  // Serpent-wgl2: direct-DOM marquee box writer — function declaration so it
  // is hoisted before the mousedown handler that calls it.
  function applyMarqueeBoxStyle(rect: {
    left: number; top: number; width: number; height: number;
  } | null): void {
    const el = marqueeBoxRef.current;
    if (!el) return;
    if (rect === null) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  }

  // ── clearAssetSelection ────────────────────────────────────────────────
  // Also clears folder-card selection (REQ-FOLDER-010): the two selections
  // are cleared together on Esc / empty-canvas click / scope changes.
  // Discovery filter refreshes may pass `{ preserveFolders: true }` so a
  // folder multi-select is not wiped when only the asset grid reloads
  // (Serpent-w9c6).
  function clearAssetSelection(options?: { preserveFolders?: boolean }) {
    setSelectedAssetId(undefined);
    setSelectedAssetIds([]);
    selectionAnchorRef.current = null;
    if (!options?.preserveFolders) {
      setSelectedFolderIds?.([]);
      folderSelectionAnchorRef.current = null;
    }
    browseSelectionAnchorRef.current = null;
    onSelectionCleared?.();
  }

  const assetIds = useMemo(
    () => selectionAssetIds ?? assets.map((asset) => asset.assetId),
    [assets, selectionAssetIds],
  );

  const browseSelectionItems = useMemo(
    () => buildBrowseSelectionOrder(folderIds, assetIds),
    [assetIds, folderIds],
  );

  function applyShiftBrowseSelection(
    target: BrowseSelectionAnchor,
    event: React.MouseEvent,
  ): boolean {
    if (!event.shiftKey || !browseSelectionAnchorRef.current) return false;
    const resolution = resolveShiftBrowseRange({
      items: browseSelectionItems,
      anchor: browseSelectionAnchorRef.current,
      target,
      currentFolderIds: selectedFolderIds,
      currentAssetIds: selectedAssetIds,
      additive: isToggleSelectionModifier(event, selectionPlatform),
    });
    if (!resolution) return false;
    if (setSelectedFolderIds) {
      setSelectedFolderIds(resolution.folderIds);
    }
    setSelectedAssetIds(resolution.assetIds);
    setSelectedAssetId(
      resolution.assetIds.includes(target.id) && target.kind === "asset"
        ? target.id
        : resolution.assetIds.at(-1),
    );
    if (resolution.folderIds.length > 0) {
      folderSelectionAnchorRef.current = resolution.folderIds[0]!;
    }
    if (resolution.assetIds.length > 0) {
      selectionAnchorRef.current = resolution.assetIds[0]!;
    }
    browseSelectionAnchorRef.current = resolution.anchor;
    return true;
  }

  function applyMasonryShiftSelection(
    assetId: string,
    event: React.MouseEvent,
  ): boolean {
    if (!masonryShiftSelection || !event.shiftKey) return false;
    const anchorId = selectionAnchorRef.current;
    const canvas = workspaceCanvasRef.current;
    if (!anchorId || !canvas) return false;
    const items = [
      ...canvas.querySelectorAll<HTMLElement>(
        ".asset-card[data-asset-id]",
      ),
    ].flatMap((card) => {
      const id = card.dataset.assetId;
      if (!id) return [];
      const rect = card.getBoundingClientRect();
      return [
        { id, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      ];
    });
    const range = resolveMasonryCenterRange({
      items,
      browseOrder: assetIds,
      anchorId,
      targetId: assetId,
    });
    if (range.length === 0) return false;
    const nextAssetIds = isToggleSelectionModifier(event, selectionPlatform)
      ? [...new Set([...selectedAssetIds, ...range])]
      : range;
    setSelectedAssetIds(nextAssetIds);
    setSelectedAssetId(assetId);
    browseSelectionAnchorRef.current = { kind: "asset", id: anchorId };
    return true;
  }

  // ── handleFolderCardClick ───────────────────────────────────────────────
  function handleFolderCardClick(folderId: string, event: React.MouseEvent) {
    const mouseButton = cardMouseDownRef.current;
    cardMouseDownRef.current = 0;
    if (!setSelectedFolderIds) return;

    if (
      applyShiftBrowseSelection({ kind: "folder", id: folderId }, event)
    ) {
      return;
    }

    const intent = resolveFolderCardClickIntent({
      folderId,
      folderIds,
      anchorId: folderSelectionAnchorRef.current,
      modifiers: {
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
      },
      platform: selectionPlatform,
      mouseButton,
    });

    if (intent.kind === "ignore") return;

    if (intent.kind === "replace") {
      setSelectedFolderIds([...intent.folderIds]);
      folderSelectionAnchorRef.current = intent.anchorId;
      browseSelectionAnchorRef.current = {
        kind: "folder",
        id: intent.anchorId,
      };
      if (intent.clearAssets) {
        setSelectedAssetIds([]);
        setSelectedAssetId(undefined);
        selectionAnchorRef.current = null;
      }
      return;
    }

    if (intent.kind === "toggle") {
      setSelectedFolderIds((current) =>
        current.includes(intent.folderId)
          ? current.filter((id) => id !== intent.folderId)
          : [...current, intent.folderId],
      );
      folderSelectionAnchorRef.current = intent.anchorId;
      browseSelectionAnchorRef.current = {
        kind: "folder",
        id: intent.anchorId,
      };
      return;
    }
  }

  // ── handleCardClick (was selectAsset) ──────────────────────────────────
  function handleCardClick(assetId: string, event: React.MouseEvent) {
    // Suppress clicks triggered by non-left-button interactions (e.g., the
    // synthetic click dispatched during a right-click in Playwright tests).
    if (cardMouseDownRef.current !== 0) {
      cardMouseDownRef.current = 0;
      return;
    }

    if (applyMasonryShiftSelection(assetId, event)) {
      return;
    }
    if (applyShiftBrowseSelection({ kind: "asset", id: assetId }, event)) {
      return;
    }

    if (isToggleSelectionModifier(event, selectionPlatform)) {
      setSelectedAssetIds((current) => {
        if (current.includes(assetId)) {
          const next = current.filter((id) => id !== assetId);
          setSelectedAssetId(next.at(-1));
          if (next.length === 0) {
            selectionAnchorRef.current = null;
            browseSelectionAnchorRef.current = null;
          }
          return next;
        }
        setSelectedAssetId(assetId);
        return [...current, assetId];
      });
      selectionAnchorRef.current = assetId;
      browseSelectionAnchorRef.current = { kind: "asset", id: assetId };
      return;
    }
    setSelectedAssetIds([assetId]);
    setSelectedAssetId(assetId);
    selectionAnchorRef.current = assetId;
    browseSelectionAnchorRef.current = { kind: "asset", id: assetId };
    if (setSelectedFolderIds) {
      setSelectedFolderIds([]);
      folderSelectionAnchorRef.current = null;
    }
  }

  // ── handleCanvasMouseDown ──────────────────────────────────────────────
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          ".asset-card, .folder-card, .external-drop-overlay, .asset-loading-more",
        )
      )
        return;
      if (previewAsset) return;
      if (draggedMemberId || draggedCollectionId) return;
      // Only left-button drags start a marquee
      if (e.button !== 0) return;

      // `preventDefault()` below intentionally prevents the blank canvas from
      // taking focus.  Without first releasing focus from the navigation
      // button, pressing Shift to begin an additive marquee switches Chromium
      // into keyboard focus modality and paints a focus ring around the
      // current folder for the whole drag.  The folder is still the active
      // scope; it simply must not remain the focused control once the pointer
      // starts a canvas interaction.
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) activeElement.blur();

      e.preventDefault();

      marqueeStartRef.current = { x: e.clientX, y: e.clientY };
      marqueePointerClientRef.current = { x: e.clientX, y: e.clientY };
      const canvas = workspaceCanvasRef.current ?? e.currentTarget;
      const canvasViewport = canvasViewportFromMetrics(
        canvas.getBoundingClientRect(),
        canvas,
      );
      marqueeStartContentRef.current = clientPointToContent(
        { x: e.clientX, y: e.clientY },
        canvasViewport,
        { left: canvas.scrollLeft, top: canvas.scrollTop },
      );
      marqueeHitIdsRef.current = [];
      marqueeFolderHitIdsRef.current = [];
      // Modifier snapshot is taken once here and frozen for the whole drag
      // (REQ-SELECT-001 rule 5) — it must not be re-derived from later events.
      const modifierSnapshot = {
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
      };
      marqueeModifiersRef.current = modifierSnapshot;
      marqueeInitialSelectionRef.current = isMarqueeAdditive(
        modifierSnapshot,
        selectionPlatform,
      )
        ? [...selectedAssetIds]
        : [];
      marqueeInitialFolderSelectionRef.current = isMarqueeAdditive(
        modifierSnapshot,
        selectionPlatform,
      )
        ? [...selectedFolderIds]
        : [];
      applyMarqueeBoxStyle({
        left: e.clientX,
        top: e.clientY,
        width: 0,
        height: 0,
      });
      // Serpent-wgl2: the hits diff key must not leak across marquees — a
      // second drag over the same region would otherwise skip every update.
      marqueeLastHitsKeyRef.current = "";
      marqueeActiveRef.current = true;
    },
    [
      previewAsset,
      draggedMemberId,
      draggedCollectionId,
      selectedAssetIds,
      selectedFolderIds,
      selectionPlatform,
      workspaceCanvasRef,
    ],
  );

  // ── Marquee document-level mousemove + mouseup when active ─────────────
  useEffect(() => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;

    const AUTO_SCROLL_ZONE = 40; // px from top/bottom edge
    const MAX_SCROLL_SPEED = 8; // px per frame at edge

    const readCanvasViewport = () =>
      canvasViewportFromMetrics(canvas.getBoundingClientRect(), canvas);

    const readCanvasScroll = () => ({
      left: canvas.scrollLeft,
      top: canvas.scrollTop,
    });

    // REQ-FOLDER-010: the marquee scans both asset and folder cards in one
    // DOM pass and returns their hits separately so each keeps its own
    // selection array, while sharing the same modifier snapshot/semantics.
    // The selection box is kept in canvas-content coordinates. DOMRects are
    // converted into that same space before intersection, so scrolling cannot
    // make the hit set diverge from the visible marquee.
    const collectHits = (box: MarqueeRect) => {
      const assetHitIds: string[] = [];
      const folderHitIds: string[] = [];
      const viewport = readCanvasViewport();
      const scroll = readCanvasScroll();
      const cards = canvas.querySelectorAll<HTMLElement>(
        "[data-asset-id], [data-folder-id]",
      );
      // Serpent-wgl2: cache card rects in canvas-content coordinates — they
      // stay valid while scrolling and are only dropped when the canvas
      // layout size changes (window resize / column reflow). Scrolling the
      // grid therefore costs one viewport read instead of N forced reflows.
      const layoutSig = `${canvas.clientWidth}x${canvas.clientHeight}`;
      if (layoutSig !== marqueeCacheLayoutSigRef.current) {
        marqueeCacheLayoutSigRef.current = layoutSig;
        marqueeCardRectsRef.current.clear();
      }
      const cardRects = marqueeCardRectsRef.current;
      for (const card of cards) {
        const key = card.dataset.assetId ?? card.dataset.folderId ?? "";
        let cardContentRect = key === "" ? undefined : cardRects.get(key);
        if (cardContentRect === undefined) {
          const rect = card.getBoundingClientRect();
          cardContentRect = viewportRectToContent(
            {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            },
            viewport,
            scroll,
          );
          if (key !== "") cardRects.set(key, cardContentRect);
        }
        if (rectsIntersect(cardContentRect, box)) {
          const assetId = card.dataset.assetId;
          const folderId = card.dataset.folderId;
          if (assetId) assetHitIds.push(assetId);
          else if (folderId) folderHitIds.push(folderId);
        }
      }
      return { assetHitIds, folderHitIds };
    };

    const applyMarqueeHits = (hits: {
      assetHitIds: string[];
      folderHitIds: string[];
    }) => {
      marqueeHitIdsRef.current = hits.assetHitIds;
      marqueeFolderHitIdsRef.current = hits.folderHitIds;

      // Serpent-wgl2: only push to React when the hit set actually changed —
      // most frames move the box without crossing a card boundary, and the
      // previous per-frame setState re-rendered the whole selection grid.
      const hitsKey = `${hits.assetHitIds.join("")} ${hits.folderHitIds.join("")}`;
      if (hitsKey === marqueeLastHitsKeyRef.current) return;
      marqueeLastHitsKeyRef.current = hitsKey;

      // Always read the mousedown-time snapshot, never the live event
      // modifiers — the operation must not change mid-drag.
      const nextSelection = computeMarqueeSelection(
        marqueeInitialSelectionRef.current,
        hits.assetHitIds,
        marqueeModifiersRef.current,
        selectionPlatform,
      );
      setSelectedAssetIds(nextSelection);
      setSelectedAssetId(nextSelection[0]);
      if (setSelectedFolderIds) {
        setSelectedFolderIds(
          computeMarqueeSelection(
            marqueeInitialFolderSelectionRef.current,
            hits.folderHitIds,
            marqueeModifiersRef.current,
            selectionPlatform,
          ),
        );
      }
    };

    const updateMarquee = (pointer: { x: number; y: number }) => {
      const viewport = readCanvasViewport();
      const scroll = readCanvasScroll();
      const contentPoint = clientPointToContent(
        pointer,
        viewport,
        scroll,
      );
      const contentRect = contentRectFromPoints(
        marqueeStartContentRef.current,
        contentPoint,
      );
      const viewportRect = contentRectToViewport(
        contentRect,
        viewport,
        scroll,
      );
      const clippedRect = clipRectToViewport(viewportRect, viewport);
      if (clippedRect) {
        applyMarqueeBoxStyle({
          left: clippedRect.left,
          top: clippedRect.top,
          width: clippedRect.right - clippedRect.left,
          height: clippedRect.bottom - clippedRect.top,
        });
      } else {
        // Pointer is entirely outside the canvas — keep the box hidden while
        // retaining the content-space rectangle for hit testing.
        applyMarqueeBoxStyle({
          left: viewport.left,
          top: viewport.top,
          width: 0,
          height: 0,
        });
      }
      applyMarqueeHits(collectHits(contentRect));
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!marqueeActiveRef.current) return;

      const pointer = { x: e.clientX, y: e.clientY };
      marqueePointerClientRef.current = pointer;
      // Serpent-wgl2: park the pointer and run the marquee once per animation
      // frame — the raw pointermove stream (~120Hz on high-refresh displays)
      // would otherwise force a layout pass (getBoundingClientRect per card)
      // on every event.
      if (marqueeRafRef.current === null) {
        marqueeRafRef.current = requestAnimationFrame(() => {
          marqueeRafRef.current = null;
          // Serpent-wgl2: a mouseup between pointermove and this frame must
          // not resurrect the marquee box.
          if (!marqueeActiveRef.current) return;
          updateMarquee(marqueePointerClientRef.current);
        });
      }

      const canvasViewport = readCanvasViewport();

      // Auto-scroll when pointer is near canvas top/bottom edges
      let scrollDirection = 0;
      let scrollSpeed = 0;
      if (
        e.clientY >= canvasViewport.top &&
        e.clientY <= canvasViewport.bottom
      ) {
        if (e.clientY < canvasViewport.top + AUTO_SCROLL_ZONE) {
          const dist = canvasViewport.top + AUTO_SCROLL_ZONE - e.clientY;
          scrollSpeed = Math.round(
            (dist / AUTO_SCROLL_ZONE) * MAX_SCROLL_SPEED,
          );
          scrollDirection = -1;
        } else if (
          e.clientY > canvasViewport.bottom - AUTO_SCROLL_ZONE
        ) {
          const dist =
            e.clientY - (canvasViewport.bottom - AUTO_SCROLL_ZONE);
          scrollSpeed = Math.round(
            (dist / AUTO_SCROLL_ZONE) * MAX_SCROLL_SPEED,
          );
          scrollDirection = 1;
        }
      }
      autoScrollRef.current = { direction: scrollDirection, speed: scrollSpeed };

      if (scrollDirection !== 0 && autoScrollRafRef.current === null) {
        // RAF-driven continuous auto-scroll
        const autoScrollLoop = () => {
          const { direction, speed } = autoScrollRef.current;
          if (direction === 0 || speed === 0) {
            autoScrollRafRef.current = null;
            return;
          }
          const previousScrollTop = canvas.scrollTop;
          const maxScrollTop = Math.max(
            0,
            canvas.scrollHeight - canvas.clientHeight,
          );
          canvas.scrollTop = Math.min(
            maxScrollTop,
            Math.max(0, previousScrollTop + direction * speed),
          );
          if (canvas.scrollTop === previousScrollTop) {
            autoScrollRef.current = { direction: 0, speed: 0 };
            autoScrollRafRef.current = null;
            return;
          }
          updateMarquee(marqueePointerClientRef.current);
          autoScrollRafRef.current = requestAnimationFrame(autoScrollLoop);
        };
        autoScrollRafRef.current = requestAnimationFrame(autoScrollLoop);
      }
    };

    const handleCanvasScroll = () => {
      if (!marqueeActiveRef.current) return;
      updateMarquee(marqueePointerClientRef.current);
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!marqueeActiveRef.current) return;
      marqueePointerClientRef.current = { x: e.clientX, y: e.clientY };
      updateMarquee(marqueePointerClientRef.current);
      marqueeActiveRef.current = false;
      autoScrollRef.current = { direction: 0, speed: 0 };
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      if (marqueeRafRef.current !== null) {
        cancelAnimationFrame(marqueeRafRef.current);
        marqueeRafRef.current = null;
      }

      const start = marqueeStartRef.current;
      const dx = Math.abs(e.clientX - start.x);
      const dy = Math.abs(e.clientY - start.y);

      // Tiny drag (< 5px) is a click on empty canvas. A plain click clears
      // the selection; a Cmd/Ctrl/Shift click is a toggle/extend gesture and
      // must leave it untouched.
      if (dx < 5 && dy < 5) {
        if (!isMarqueeAdditive(marqueeModifiersRef.current, selectionPlatform)) {
          clearAssetSelection();
        }
        applyMarqueeBoxStyle(null);
        return;
      }

      // Finalize selection — already set during mousemove;
      // on a no-modifier marquee that hit nothing (asset or folder), clear.
      // Use the mousedown-time snapshot, not this mouseup event's live
      // modifiers, so a key released/pressed mid-drag can't retroactively
      // change the operation (REQ-SELECT-001 rule 5).
      if (!isMarqueeAdditive(marqueeModifiersRef.current, selectionPlatform)) {
        if (
          marqueeHitIdsRef.current.length === 0 &&
          marqueeFolderHitIdsRef.current.length === 0
        ) {
          clearAssetSelection();
        }
      }

      // Set anchors for subsequent Shift+click range-extension
      if (marqueeHitIdsRef.current.length > 0) {
        selectionAnchorRef.current = marqueeHitIdsRef.current[0]!;
        browseSelectionAnchorRef.current = {
          kind: "asset",
          id: marqueeHitIdsRef.current[0]!,
        };
      }
      if (marqueeFolderHitIdsRef.current.length > 0) {
        folderSelectionAnchorRef.current = marqueeFolderHitIdsRef.current[0]!;
        if (!browseSelectionAnchorRef.current) {
          browseSelectionAnchorRef.current = {
            kind: "folder",
            id: marqueeFolderHitIdsRef.current[0]!,
          };
        }
      }

      applyMarqueeBoxStyle(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("scroll", handleCanvasScroll, { passive: true });
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("scroll", handleCanvasScroll);
      marqueeActiveRef.current = false;
      autoScrollRef.current = { direction: 0, speed: 0 };
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      if (marqueeRafRef.current !== null) {
        cancelAnimationFrame(marqueeRafRef.current);
        marqueeRafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs + stable setState setters; intentional single-registration
  }, []);

  return {
    handleCanvasMouseDown,
    clearAssetSelection,
    selectionAnchorRef,
    setAssetSelectionAnchor,
    folderSelectionAnchorRef,
    handleCardClick,
    handleFolderCardClick,
    cardMouseDownRef,
    selectedIdSet,
  };
}
