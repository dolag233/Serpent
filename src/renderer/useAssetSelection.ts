import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetSummary } from "../shared/asset-types";
import { computeMarqueeSelection, isMarqueeAdditive } from "./marquee-selection";

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
  /** Visible folder-card ids (REQ-FOLDER-010), used for Shift+click range and marquee. */
  folderIds?: string[];
  /** Currently selected folder-card IDs */
  selectedFolderIds?: string[];
  /** Setter for folder multi-select */
  setSelectedFolderIds?: React.Dispatch<React.SetStateAction<string[]>>;
}

export interface UseAssetSelectionReturn {
  /** Attach to the canvas element's onMouseDown */
  handleCanvasMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Clear all selection state (Esc, empty-canvas click, etc.) — also clears folder selection. */
  clearAssetSelection: () => void;
  /** Ref for the selection anchor used by Shift+click range extension.
   *  External code may also write to this ref (e.g. preview open, select-all). */
  selectionAnchorRef: React.MutableRefObject<string | null>;
  /** Same as `selectionAnchorRef`, but for folder-card Shift+click ranges. */
  folderSelectionAnchorRef: React.MutableRefObject<string | null>;
  /** Attach to individual asset cards: onMouseDown sets the button, onClick calls this */
  handleCardClick: (assetId: string, event: React.MouseEvent) => void;
  /**
   * Attach to folder cards' onClick. Cmd/Ctrl and Shift apply select/toggle/
   * range semantics and return "select"; a plain click leaves selection
   * untouched and returns "navigate" so the caller can enter the folder
   * (REQ-FOLDER-010's click-to-navigate takes priority over click-to-select).
   */
  handleFolderCardClick: (
    folderId: string,
    event: React.MouseEvent,
  ) => "select" | "navigate";
  /** Ref that must be set in the card's onMouseDown: `cardMouseDownRef.current = e.button` */
  cardMouseDownRef: React.MutableRefObject<number>;
  /** Current marquee box (null when not dragging). Render a div with these coordinates. */
  marqueeBox: { left: number; top: number; width: number; height: number } | null;
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
  folderIds = [],
  selectedFolderIds = [],
  setSelectedFolderIds,
}: UseAssetSelectionParams): UseAssetSelectionReturn {
  // ── Derived ────────────────────────────────────────────────────────────
  const selectedIdSet = useMemo(
    () => new Set(selectedAssetIds),
    [selectedAssetIds],
  );

  // ── Selection anchor (Shift+click range extension) ─────────────────────
  const selectionAnchorRef = useRef<string | null>(null);
  const folderSelectionAnchorRef = useRef<string | null>(null);

  // ── Card click button guard ────────────────────────────────────────────
  const cardMouseDownRef = useRef<number>(0);

  // ── Marquee state ──────────────────────────────────────────────────────
  const [marqueeBox, setMarqueeBox] = useState<{
    left: number; top: number; width: number; height: number;
  } | null>(null);
  const marqueeStartRef = useRef({ x: 0, y: 0 });
  const marqueeHitIdsRef = useRef<string[]>([]);
  const marqueeAccumulatedHitIdsRef = useRef<Set<string>>(new Set());
  const marqueeInitialSelectionRef = useRef<string[]>([]);
  const marqueeFolderHitIdsRef = useRef<string[]>([]);
  const marqueeFolderAccumulatedHitIdsRef = useRef<Set<string>>(new Set());
  const marqueeInitialFolderSelectionRef = useRef<string[]>([]);
  const marqueeActiveRef = useRef(false);
  const autoScrollRef = useRef<{ direction: number; speed: number }>({ direction: 0, speed: 0 });
  const autoScrollRafRef = useRef<number | null>(null);
  const marqueeBoxRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const marqueeModifiersRef = useRef<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>({ metaKey: false, ctrlKey: false, shiftKey: false });

  // ── clearAssetSelection ────────────────────────────────────────────────
  // Also clears folder-card selection (REQ-FOLDER-010): the two selections
  // are cleared together on Esc / empty-canvas click / scope changes.
  function clearAssetSelection() {
    setSelectedAssetId(undefined);
    setSelectedAssetIds([]);
    selectionAnchorRef.current = null;
    setSelectedFolderIds?.([]);
    folderSelectionAnchorRef.current = null;
  }

  // ── handleFolderCardClick ───────────────────────────────────────────────
  function handleFolderCardClick(
    folderId: string,
    event: React.MouseEvent,
  ): "select" | "navigate" {
    if (cardMouseDownRef.current !== 0) {
      cardMouseDownRef.current = 0;
      return "select";
    }
    if (!setSelectedFolderIds) return "navigate";
    if (event.shiftKey && folderSelectionAnchorRef.current) {
      const anchorIndex = folderIds.indexOf(folderSelectionAnchorRef.current);
      const targetIndex = folderIds.indexOf(folderId);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const range = folderIds.slice(
          Math.min(anchorIndex, targetIndex),
          Math.max(anchorIndex, targetIndex) + 1,
        );
        setSelectedFolderIds(
          event.metaKey || event.ctrlKey
            ? (current) => [...new Set([...current, ...range])]
            : range,
        );
        return "select";
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedFolderIds((current) =>
        current.includes(folderId)
          ? current.filter((id) => id !== folderId)
          : [...current, folderId],
      );
      folderSelectionAnchorRef.current = folderId;
      return "select";
    }
    // Plain click: selection is left untouched, caller navigates into the
    // folder (same as the sidebar row) instead of just selecting it.
    return "navigate";
  }

  // ── handleCardClick (was selectAsset) ──────────────────────────────────
  function handleCardClick(assetId: string, event: React.MouseEvent) {
    // Suppress clicks triggered by non-left-button interactions (e.g., the
    // synthetic click dispatched during a right-click in Playwright tests).
    if (cardMouseDownRef.current !== 0) {
      cardMouseDownRef.current = 0;
      return;
    }
    const visibleIds = assets.map((asset) => asset.assetId);
    if (event.shiftKey && selectionAnchorRef.current) {
      const anchorIndex = visibleIds.indexOf(selectionAnchorRef.current);
      const targetIndex = visibleIds.indexOf(assetId);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const range = visibleIds.slice(
          Math.min(anchorIndex, targetIndex),
          Math.max(anchorIndex, targetIndex) + 1,
        );
        setSelectedAssetIds(
          event.metaKey || event.ctrlKey
            ? (current) => [...new Set([...current, ...range])]
            : range,
        );
        setSelectedAssetId(assetId);
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedAssetIds((current) => {
        if (current.includes(assetId)) {
          const next = current.filter((id) => id !== assetId);
          setSelectedAssetId(next.at(-1));
          if (next.length === 0) selectionAnchorRef.current = null;
          return next;
        }
        setSelectedAssetId(assetId);
        return [...current, assetId];
      });
      selectionAnchorRef.current = assetId;
      return;
    }
    setSelectedAssetIds([assetId]);
    setSelectedAssetId(assetId);
    selectionAnchorRef.current = assetId;
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
      marqueeHitIdsRef.current = [];
      marqueeAccumulatedHitIdsRef.current = new Set();
      marqueeFolderHitIdsRef.current = [];
      marqueeFolderAccumulatedHitIdsRef.current = new Set();
      // Modifier snapshot is taken once here and frozen for the whole drag
      // (REQ-SELECT-001 rule 5) — it must not be re-derived from later events.
      const modifierSnapshot = {
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
      };
      marqueeModifiersRef.current = modifierSnapshot;
      marqueeInitialSelectionRef.current = isMarqueeAdditive(modifierSnapshot)
        ? [...selectedAssetIds]
        : [];
      marqueeInitialFolderSelectionRef.current = isMarqueeAdditive(modifierSnapshot)
        ? [...selectedFolderIds]
        : [];
      setMarqueeBox({
        left: e.clientX,
        top: e.clientY,
        width: 0,
        height: 0,
      });
      marqueeActiveRef.current = true;
    },
    [previewAsset, draggedMemberId, draggedCollectionId, selectedAssetIds, selectedFolderIds],
  );

  // ── Marquee document-level mousemove + mouseup when active ─────────────
  useEffect(() => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;

    const AUTO_SCROLL_ZONE = 40; // px from top/bottom edge
    const MAX_SCROLL_SPEED = 8; // px per frame at edge

    // REQ-FOLDER-010: the marquee scans both asset and folder cards in one
    // DOM pass and returns their hits separately so each keeps its own
    // selection array, while sharing the same modifier snapshot/semantics.
    const collectHits = (box: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }) => {
      const assetHitIds: string[] = [];
      const folderHitIds: string[] = [];
      const cards = canvas.querySelectorAll<HTMLElement>(
        "[data-asset-id], [data-folder-id]",
      );
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        if (
          rect.left < box.right &&
          rect.right > box.left &&
          rect.top < box.bottom &&
          rect.bottom > box.top
        ) {
          const assetId = card.dataset.assetId;
          const folderId = card.dataset.folderId;
          if (assetId) assetHitIds.push(assetId);
          else if (folderId) folderHitIds.push(folderId);
        }
      }
      return { assetHitIds, folderHitIds };
    };

    const applyMarqueeHits = (
      hits: { assetHitIds: string[]; folderHitIds: string[] },
      accumulate: boolean,
    ) => {
      if (accumulate) {
        for (const assetId of hits.assetHitIds) {
          marqueeAccumulatedHitIdsRef.current.add(assetId);
        }
        for (const folderId of hits.folderHitIds) {
          marqueeFolderAccumulatedHitIdsRef.current.add(folderId);
        }
      }
      const effectiveHitIds = [
        ...new Set([
          ...marqueeAccumulatedHitIdsRef.current,
          ...hits.assetHitIds,
        ]),
      ];
      const effectiveFolderHitIds = [
        ...new Set([
          ...marqueeFolderAccumulatedHitIdsRef.current,
          ...hits.folderHitIds,
        ]),
      ];
      marqueeHitIdsRef.current = effectiveHitIds;
      marqueeFolderHitIdsRef.current = effectiveFolderHitIds;

      // Always read the mousedown-time snapshot, never the live event
      // modifiers — the operation must not change mid-drag.
      const nextSelection = computeMarqueeSelection(
        marqueeInitialSelectionRef.current,
        effectiveHitIds,
        marqueeModifiersRef.current,
      );
      setSelectedAssetIds(nextSelection);
      setSelectedAssetId(nextSelection[0]);
      if (setSelectedFolderIds) {
        setSelectedFolderIds(
          computeMarqueeSelection(
            marqueeInitialFolderSelectionRef.current,
            effectiveFolderHitIds,
            marqueeModifiersRef.current,
          ),
        );
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!marqueeActiveRef.current) return;

      const start = marqueeStartRef.current;
      const canvasRect = canvas.getBoundingClientRect();

      // Compute raw marquee rect from pointer movement
      let left = Math.min(start.x, e.clientX);
      let top = Math.min(start.y, e.clientY);
      let width = Math.abs(e.clientX - start.x);
      let height = Math.abs(e.clientY - start.y);

      // Clip to canvas visible bounds so the box never extends over nav/inspector
      const boxRight = left + width;
      const boxBottom = top + height;
      const clippedLeft = Math.max(left, canvasRect.left);
      const clippedTop = Math.max(top, canvasRect.top);
      const clippedRight = Math.min(boxRight, canvasRect.right);
      const clippedBottom = Math.min(boxBottom, canvasRect.bottom);

      if (clippedRight > clippedLeft && clippedBottom > clippedTop) {
        left = clippedLeft;
        top = clippedTop;
        width = clippedRight - clippedLeft;
        height = clippedBottom - clippedTop;
      } else {
        // Pointer is entirely outside the canvas — hide the box
        width = 0;
        height = 0;
      }

      setMarqueeBox({ left, top, width, height });

      // Store for RAF-driven auto-scroll hit detection
      const currentMarqueeRect = {
        left,
        top,
        right: left + width,
        bottom: top + height,
      };
      marqueeBoxRef.current = currentMarqueeRect;

      // Intersect marquee box with visible asset cards
      const marqueeRect = {
        left,
        top,
        right: left + width,
        bottom: top + height,
      };
      applyMarqueeHits(collectHits(marqueeRect), false);

      // Auto-scroll when pointer is near canvas top/bottom edges
      let scrollDirection = 0;
      let scrollSpeed = 0;
      if (
        e.clientY >= canvasRect.top &&
        e.clientY <= canvasRect.bottom
      ) {
        if (e.clientY < canvasRect.top + AUTO_SCROLL_ZONE) {
          const dist = canvasRect.top + AUTO_SCROLL_ZONE - e.clientY;
          scrollSpeed = Math.round(
            (dist / AUTO_SCROLL_ZONE) * MAX_SCROLL_SPEED,
          );
          scrollDirection = -1;
        } else if (
          e.clientY > canvasRect.bottom - AUTO_SCROLL_ZONE
        ) {
          const dist =
            e.clientY - (canvasRect.bottom - AUTO_SCROLL_ZONE);
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
          canvas.scrollTop += direction * speed;

          // Re-run hit detection with current marquee box position
          const currentBox = marqueeBoxRef.current;
          if (currentBox) {
            applyMarqueeHits(collectHits(currentBox), true);
          }
          autoScrollRafRef.current = requestAnimationFrame(autoScrollLoop);
        };
        autoScrollRafRef.current = requestAnimationFrame(autoScrollLoop);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!marqueeActiveRef.current) return;
      marqueeActiveRef.current = false;
      autoScrollRef.current = { direction: 0, speed: 0 };
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }

      const start = marqueeStartRef.current;
      const dx = Math.abs(e.clientX - start.x);
      const dy = Math.abs(e.clientY - start.y);

      // Tiny drag (< 5px) is a click on empty canvas, clear selection
      if (dx < 5 && dy < 5) {
        clearAssetSelection();
        setMarqueeBox(null);
        return;
      }

      // Finalize selection — already set during mousemove;
      // on a no-modifier marquee that hit nothing (asset or folder), clear.
      // Use the mousedown-time snapshot, not this mouseup event's live
      // modifiers, so a key released/pressed mid-drag can't retroactively
      // change the operation (REQ-SELECT-001 rule 5).
      if (!isMarqueeAdditive(marqueeModifiersRef.current)) {
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
      }
      if (marqueeFolderHitIdsRef.current.length > 0) {
        folderSelectionAnchorRef.current = marqueeFolderHitIdsRef.current[0]!;
      }

      setMarqueeBox(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      marqueeActiveRef.current = false;
      autoScrollRef.current = { direction: 0, speed: 0 };
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs + stable setState setters; intentional single-registration
  }, []);

  return {
    handleCanvasMouseDown,
    clearAssetSelection,
    selectionAnchorRef,
    folderSelectionAnchorRef,
    handleCardClick,
    handleFolderCardClick,
    cardMouseDownRef,
    marqueeBox,
    selectedIdSet,
  };
}
