import { describe, expect, it } from 'vitest';

import {
  classifyViewerWheel,
  resolveWheelGestureAnchor,
  VIEWER_WHEEL_GESTURE_TIMEOUT_MS,
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

describe('classifyViewerWheel (Serpent-yo0n)', () => {
  it('treats ctrlKey as zoom (Chromium reports trackpad pinch with ctrlKey)', () => {
    expect(classifyViewerWheel(sample({ ctrlKey: true, deltaY: 8 }))).toBe('zoom');
  });

  it('treats metaKey as zoom (explicit zoom chord)', () => {
    expect(classifyViewerWheel(sample({ metaKey: true, deltaY: 8 }))).toBe('zoom');
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

  it('treats small continuous pixel deltas as trackpad scroll and pans', () => {
    expect(classifyViewerWheel(sample({ deltaY: 12 }))).toBe('pan');
    expect(classifyViewerWheel(sample({ deltaX: 20, deltaY: 4 }))).toBe('pan');
  });

  it('treats fractional pixel deltas as trackpad precision and pans', () => {
    expect(classifyViewerWheel(sample({ deltaY: -53.5 }))).toBe('pan');
    expect(classifyViewerWheel(sample({ deltaY: 149.8 }))).toBe('pan');
  });

  it('pans on a zero delta so a no-op event never zooms', () => {
    expect(classifyViewerWheel(sample({}))).toBe('pan');
  });

  it('documents the mouse-notch threshold boundary', () => {
    expect(
      classifyViewerWheel(sample({ deltaY: VIEWER_WHEEL_MOUSE_NOTCH_THRESHOLD })),
    ).toBe('zoom');
    expect(
      classifyViewerWheel(
        sample({ deltaY: VIEWER_WHEEL_MOUSE_NOTCH_THRESHOLD - 1 }),
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
