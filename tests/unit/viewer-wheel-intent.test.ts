import { describe, expect, it } from 'vitest';

import {
  classifyViewerWheel,
  isPrimarilyHorizontalWheel,
  resolveWheelGestureAnchor,
  VIEWER_WHEEL_GESTURE_TIMEOUT_MS,
  VIEWER_WHEEL_HORIZONTAL_DOMINANCE_RATIO,
  VIEWER_WHEEL_MOUSE_NOTCH_THRESHOLD,
} from '../../src/renderer/viewer-wheel-intent';

const sample = (overrides: Partial<Parameters<typeof classifyViewerWheel>[0]>) => ({
  ctrlKey: false,
  metaKey: false,
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ...overrides,
});

describe('isPrimarilyHorizontalWheel (Serpent-4kg3)', () => {
  it('is true when |deltaX| exceeds |deltaY| by the dominance ratio', () => {
    expect(isPrimarilyHorizontalWheel({ deltaX: 40, deltaY: 10 })).toBe(true);
    expect(
      isPrimarilyHorizontalWheel({
        deltaX: VIEWER_WHEEL_HORIZONTAL_DOMINANCE_RATIO * 10 + 0.1,
        deltaY: 10,
      }),
    ).toBe(true);
  });

  it('is false when vertical is equal or dominant', () => {
    expect(isPrimarilyHorizontalWheel({ deltaX: 10, deltaY: 10 })).toBe(false);
    expect(isPrimarilyHorizontalWheel({ deltaX: 8, deltaY: 20 })).toBe(false);
    expect(isPrimarilyHorizontalWheel({ deltaX: 0, deltaY: 12 })).toBe(false);
  });

  it('is false exactly at the dominance boundary (not strictly greater)', () => {
    expect(
      isPrimarilyHorizontalWheel({
        deltaX: VIEWER_WHEEL_HORIZONTAL_DOMINANCE_RATIO * 10,
        deltaY: 10,
      }),
    ).toBe(false);
  });

  it('treats pure horizontal (zero vertical) as horizontal', () => {
    expect(isPrimarilyHorizontalWheel({ deltaX: -30, deltaY: 0 })).toBe(true);
  });
});

describe('classifyViewerWheel (Serpent-yo0n)', () => {
  it('treats ctrlKey as zoom (Chromium reports trackpad pinch with ctrlKey)', () => {
    expect(classifyViewerWheel(sample({ ctrlKey: true, deltaY: 8 }))).toBe('zoom');
  });

  it('treats metaKey as zoom (explicit zoom chord)', () => {
    expect(classifyViewerWheel(sample({ metaKey: true, deltaY: 8 }))).toBe('zoom');
  });

  it('pans on ctrlKey when the delta is primarily horizontal (Serpent-4kg3)', () => {
    // Chromium sometimes tags a two-finger horizontal slide with ctrlKey.
    expect(
      classifyViewerWheel(sample({ ctrlKey: true, deltaX: 48, deltaY: 8 })),
    ).toBe('pan');
    expect(
      classifyViewerWheel(sample({ ctrlKey: true, deltaX: -36, deltaY: 0 })),
    ).toBe('pan');
    expect(
      classifyViewerWheel(
        sample({ ctrlKey: true, deltaX: 20, deltaY: 4, deltaMode: 0 }),
      ),
    ).toBe('pan');
  });

  it('still zooms on ctrlKey when vertical dominates (real pinch / Ctrl+wheel)', () => {
    expect(
      classifyViewerWheel(sample({ ctrlKey: true, deltaX: 4, deltaY: 12 })),
    ).toBe('zoom');
    expect(
      classifyViewerWheel(sample({ ctrlKey: true, deltaX: 10, deltaY: -20 })),
    ).toBe('zoom');
    expect(
      classifyViewerWheel(sample({ ctrlKey: true, deltaX: 0, deltaY: -8 })),
    ).toBe('zoom');
  });

  it('pans on metaKey when the delta is primarily horizontal', () => {
    expect(
      classifyViewerWheel(sample({ metaKey: true, deltaX: 40, deltaY: 5 })),
    ).toBe('pan');
  });

  it('treats ambiguous ctrlKey diagonals (not horizontal-dominant) as zoom', () => {
    // |deltaX| == |deltaY| * ratio sits at the boundary → not horizontal → zoom.
    expect(
      classifyViewerWheel(
        sample({
          ctrlKey: true,
          deltaX: VIEWER_WHEEL_HORIZONTAL_DOMINANCE_RATIO * 10,
          deltaY: 10,
        }),
      ),
    ).toBe('zoom');
  });

  it('treats line-mode deltas as a mouse wheel and zooms', () => {
    expect(classifyViewerWheel(sample({ deltaY: 3, deltaMode: 1 }))).toBe('zoom');
  });

  it('treats page-mode deltas as a discrete device and zooms', () => {
    expect(classifyViewerWheel(sample({ deltaY: 1, deltaMode: 2 }))).toBe('zoom');
  });

  it('treats a large integer pixel delta as a mouse notch and zooms', () => {
    // Chrome reports a Windows mouse notch as ~100–150px per tick.
    expect(classifyViewerWheel(sample({ deltaY: -120 }))).toBe('zoom');
    expect(classifyViewerWheel(sample({ deltaY: 100 }))).toBe('zoom');
  });

  it('treats diagonal small pixel deltas as trackpad scroll and pans', () => {
    expect(classifyViewerWheel(sample({ deltaX: 20, deltaY: 4 }))).toBe('pan');
  });

  it('treats fractional pixel deltas as trackpad precision and pans', () => {
    expect(classifyViewerWheel(sample({ deltaY: -53.5 }))).toBe('pan');
    expect(classifyViewerWheel(sample({ deltaY: 149.8 }))).toBe('pan');
  });

  it('zooms a plain vertical integer wheel even below the notch threshold (Serpent-6k1)', () => {
    // macOS reports a mouse-wheel notch as small integer pixels; a strictly
    // vertical integer delta is unambiguously a mouse wheel, so it zooms
    // without Ctrl. Trackpad scroll is fractional/diagonal and still pans.
    expect(classifyViewerWheel(sample({ deltaY: 12 }))).toBe('zoom');
    expect(classifyViewerWheel(sample({ deltaY: -3 }))).toBe('zoom');
    expect(classifyViewerWheel(sample({ deltaY: 39 }))).toBe('zoom');
  });

  it('pans on a zero delta so a no-op event never zooms', () => {
    expect(classifyViewerWheel(sample({}))).toBe('pan');
  });

  it('documents the mouse-notch threshold boundary', () => {
    expect(
      classifyViewerWheel(sample({ deltaY: VIEWER_WHEEL_MOUSE_NOTCH_THRESHOLD })),
    ).toBe('zoom');
    // Below the threshold a purely-vertical integer delta is still a mouse
    // wheel (6k1); only a diagonal trackpad-style delta pans.
    expect(
      classifyViewerWheel(
        sample({ deltaY: VIEWER_WHEEL_MOUSE_NOTCH_THRESHOLD - 1 }),
      ),
    ).toBe('zoom');
    expect(
      classifyViewerWheel(
        sample({ deltaX: 6, deltaY: VIEWER_WHEEL_MOUSE_NOTCH_THRESHOLD - 1 }),
      ),
    ).toBe('pan');
  });
});

describe('resolveWheelGestureAnchor (Serpent-yo0n gesture-start anchor)', () => {
  it('anchors at the pointer position of the first event in a gesture', () => {
    const anchor = resolveWheelGestureAnchor(null, 100, 80, 1_000);
    expect(anchor).toEqual({ clientX: 100, clientY: 80, lastEventAt: 1_000 });
  });

  it('keeps the gesture-start anchor when the pointer drifts mid-gesture', () => {
    const first = resolveWheelGestureAnchor(null, 100, 80, 1_000);
    const second = resolveWheelGestureAnchor(first, 240, 190, 1_100);
    expect(second.clientX).toBe(100);
    expect(second.clientY).toBe(80);
    expect(second.lastEventAt).toBe(1_100);
  });

  it('re-anchors at the pointer after the gesture times out', () => {
    const first = resolveWheelGestureAnchor(null, 100, 80, 1_000);
    const later = resolveWheelGestureAnchor(
      first,
      240,
      190,
      1_000 + VIEWER_WHEEL_GESTURE_TIMEOUT_MS + 1,
    );
    expect(later).toEqual({
      clientX: 240,
      clientY: 190,
      lastEventAt: 1_000 + VIEWER_WHEEL_GESTURE_TIMEOUT_MS + 1,
    });
  });

  it('treats an event exactly at the timeout boundary as the same gesture', () => {
    const first = resolveWheelGestureAnchor(null, 100, 80, 1_000);
    const atBoundary = resolveWheelGestureAnchor(
      first,
      240,
      190,
      1_000 + VIEWER_WHEEL_GESTURE_TIMEOUT_MS,
    );
    expect(atBoundary.clientX).toBe(100);
  });
});
