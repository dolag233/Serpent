import { describe, expect, it, vi } from "vitest";

import { interruptPreviewReturnForReflow } from "../../src/renderer/preview-return-interruption";

function createInput() {
  const canvas = {
    dataset: {} as DOMStringMap,
    classList: { contains: () => false },
  } as unknown as HTMLElement;
  const generationRef = { current: 8 };
  const cancelRestore = vi.fn();
  const cancelRestoreRef = { current: null as (() => void) | null };
  const focusFrameRef = { current: null as number | null };
  const closingAssetRef = { current: null as string | null };
  const clearHold = vi.fn(() => { delete canvas.dataset.previewScrollHold; });
  const onInterrupted = vi.fn();

  return {
    input: {
      canvas,
      viewerOpen: false,
      restoring: false,
      generationRef,
      cancelRestoreRef,
      focusFrameRef,
      closingAssetRef,
      clearHold,
      onInterrupted,
    },
    canvas,
    generationRef,
    cancelRestore,
    cancelRestoreRef,
    focusFrameRef,
    closingAssetRef,
    clearHold,
    onInterrupted,
  };
}

describe("interruptPreviewReturnForReflow", () => {
  it("leaves an open viewer and its pending return state untouched", () => {
    const state = createInput();
    state.input.viewerOpen = true;
    state.input.restoring = true;
    state.cancelRestoreRef.current = state.cancelRestore;
    state.canvas.dataset.previewScrollHold = "1";
    state.focusFrameRef.current = 42;
    state.closingAssetRef.current = "closing-asset";

    expect(interruptPreviewReturnForReflow(state.input)).toBe(false);

    expect(state.generationRef.current).toBe(8);
    expect(state.cancelRestore).not.toHaveBeenCalled();
    expect(state.cancelRestoreRef.current).toBe(state.cancelRestore);
    expect(state.focusFrameRef.current).toBe(42);
    expect(state.closingAssetRef.current).toBe("closing-asset");
    expect(state.clearHold).not.toHaveBeenCalled();
    expect(state.onInterrupted).not.toHaveBeenCalled();
  });

  it("does not reset state when there is no pending return owner", () => {
    const state = createInput();

    expect(interruptPreviewReturnForReflow(state.input)).toBe(true);
    expect(interruptPreviewReturnForReflow(state.input)).toBe(true);

    expect(state.generationRef.current).toBe(8);
    expect(state.cancelRestore).not.toHaveBeenCalled();
    expect(state.focusFrameRef.current).toBeNull();
    expect(state.closingAssetRef.current).toBeNull();
    expect(state.clearHold).not.toHaveBeenCalled();
    expect(state.onInterrupted).not.toHaveBeenCalled();
  });

  it("invalidates and cleans a pending return exactly once before interruption", () => {
    const state = createInput();
    state.input.restoring = true;
    state.cancelRestoreRef.current = state.cancelRestore;
    state.canvas.dataset.previewScrollHold = "1";
    state.focusFrameRef.current = 42;
    state.closingAssetRef.current = "closing-asset";
    const order: string[] = [];
    state.cancelRestore.mockImplementation(() => {
      order.push("cancel-restore");
      expect(state.generationRef.current).toBe(9);
      expect(state.cancelRestoreRef.current).toBeNull();
    });
    state.clearHold.mockImplementation(() => {
      order.push("clear-hold");
      expect(state.focusFrameRef.current).toBeNull();
      expect(state.closingAssetRef.current).toBeNull();
      delete state.canvas.dataset.previewScrollHold;
    });
    state.onInterrupted.mockImplementation(() => { order.push("interrupted"); });
    const cancelledFrames: number[] = [];
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => {
      order.push("cancel-frame");
      cancelledFrames.push(frame);
    });
    const capturedGeneration = state.generationRef.current;
    let staleCompletionApplied = 0;
    const lateCompletion = () => {
      if (state.generationRef.current === capturedGeneration) staleCompletionApplied += 1;
    };

    try {
      expect(interruptPreviewReturnForReflow(state.input)).toBe(true);
      lateCompletion();
      state.input.restoring = false;
      expect(interruptPreviewReturnForReflow(state.input)).toBe(true);

      expect(state.generationRef.current).toBe(capturedGeneration + 1);
      expect(staleCompletionApplied).toBe(0);
      expect(state.cancelRestore).toHaveBeenCalledOnce();
      expect(state.cancelRestoreRef.current).toBeNull();
      expect(cancelledFrames).toEqual([42]);
      expect(state.focusFrameRef.current).toBeNull();
      expect(state.closingAssetRef.current).toBeNull();
      expect(state.canvas.dataset.previewScrollHold).toBeUndefined();
      expect(state.clearHold).toHaveBeenCalledOnce();
      expect(state.onInterrupted).toHaveBeenCalledOnce();
      expect(order).toEqual(["cancel-restore", "cancel-frame", "clear-hold", "interrupted"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("treats the preview scroll hold as pending return ownership", () => {
    const state = createInput();
    state.canvas.dataset.previewScrollHold = "1";

    expect(interruptPreviewReturnForReflow(state.input)).toBe(true);

    expect(state.generationRef.current).toBe(9);
    expect(state.clearHold).toHaveBeenCalledOnce();
    expect(state.onInterrupted).toHaveBeenCalledOnce();
  });
});
