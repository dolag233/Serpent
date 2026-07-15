import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetSummary } from "../shared/asset-types";

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
}

export interface UseAssetSelectionReturn {
  /** Attach to the canvas element's onMouseDown */
  handleCanvasMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Clear all selection state (Esc, empty-canvas click, etc.) */
  clearAssetSelection: () => void;
  /** Ref for the selection anchor used by Shift+click range extension.
   *  External code may also write to this ref (e.g. preview open, select-all). */
  selectionAnchorRef: React.MutableRefObject<string | null>;
  /** Attach to individual asset cards: onMouseDown sets the button, onClick calls this */
  handleCardClick: (assetId: string, event: React.MouseEvent) => void;
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
}: UseAssetSelectionParams): UseAssetSelectionReturn {
  // ── Derived ────────────────────────────────────────────────────────────
  const selectedIdSet = useMemo(
    () => new Set(selectedAssetIds),
    [selectedAssetIds],
  );

  // ── Selection anchor (Shift+click range extension) ─────────────────────
  const selectionAnchorRef = useRef<string | null>(null);

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
  const marqueeActiveRef = useRef(false);
  const autoScrollRef = useRef<{ direction: number; speed: number }>({ direction: 0, speed: 0 });
  const autoScrollRafRef = useRef<number | null>(null);
  const marqueeBoxRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const marqueeModifiersRef = useRef<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>({ metaKey: false, ctrlKey: false, shiftKey: false });

  // ── clearAssetSelection ────────────────────────────────────────────────
  function clearAssetSelection() {
    setSelectedAssetId(undefined);
    setSelectedAssetIds([]);
    selectionAnchorRef.current = null;
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
      if (target.closest(".asset-card, .external-drop-overlay, .asset-loading-more"))
        return;
      if (previewAsset) return;
      if (draggedMemberId || draggedCollectionId) return;
      // Only left-button drags start a marquee
      if (e.button !== 0) return;

      e.preventDefault();

      marqueeStartRef.current = { x: e.clientX, y: e.clientY };
      marqueeHitIdsRef.current = [];
      marqueeAccumulatedHitIdsRef.current = new Set();
      marqueeInitialSelectionRef.current =
        e.metaKey || e.ctrlKey || e.shiftKey ? [...selectedAssetIds] : [];
      marqueeModifiersRef.current = {
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
      };
      setMarqueeBox({
        left: e.clientX,
        top: e.clientY,
        width: 0,
        height: 0,
      });
      marqueeActiveRef.current = true;
    },
    [previewAsset, draggedMemberId, draggedCollectionId, selectedAssetIds],
  );

  // ── Marquee document-level mousemove + mouseup when active ─────────────
  useEffect(() => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;

    const AUTO_SCROLL_ZONE = 40; // px from top/bottom edge
    const MAX_SCROLL_SPEED = 8; // px per frame at edge

    const collectHitIds = (box: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }) => {
      const hitIds: string[] = [];
      const cards = canvas.querySelectorAll<HTMLElement>("[data-asset-id]");
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        if (
          rect.left < box.right &&
          rect.right > box.left &&
          rect.top < box.bottom &&
          rect.bottom > box.top
        ) {
          const id = card.dataset.assetId;
          if (id) hitIds.push(id);
        }
      }
      return hitIds;
    };

    const applyMarqueeHits = (currentHitIds: string[], accumulate: boolean) => {
      if (accumulate) {
        for (const assetId of currentHitIds) {
          marqueeAccumulatedHitIdsRef.current.add(assetId);
        }
      }
      const effectiveHitIds = [
        ...new Set([
          ...marqueeAccumulatedHitIdsRef.current,
          ...currentHitIds,
        ]),
      ];
      marqueeHitIdsRef.current = effectiveHitIds;

      const modifiers = marqueeModifiersRef.current;
      const nextSelection =
        modifiers.metaKey || modifiers.ctrlKey || modifiers.shiftKey
          ? [...new Set([...marqueeInitialSelectionRef.current, ...effectiveHitIds])]
          : effectiveHitIds;
      setSelectedAssetIds(nextSelection);
      setSelectedAssetId(nextSelection[0]);
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
      marqueeModifiersRef.current = { metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey };

      // Intersect marquee box with visible asset cards
      const marqueeRect = {
        left,
        top,
        right: left + width,
        bottom: top + height,
      };
      const hitIds = collectHitIds(marqueeRect);
      applyMarqueeHits(hitIds, false);

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
            applyMarqueeHits(collectHitIds(currentBox), true);
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
      // on a no-modifier marquee that hit nothing, clear too
      if (!(e.metaKey || e.ctrlKey || e.shiftKey)) {
        if (marqueeHitIdsRef.current.length === 0) clearAssetSelection();
      }

      // Set anchor for subsequent Shift+click range-extension
      if (marqueeHitIdsRef.current.length > 0) {
        selectionAnchorRef.current = marqueeHitIdsRef.current[0]!;
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
    handleCardClick,
    cardMouseDownRef,
    marqueeBox,
    selectedIdSet,
  };
}
