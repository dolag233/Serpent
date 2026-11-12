// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useCardHoverScrub } from '../../src/renderer/use-card-hover-scrub';

afterEach(() => vi.useRealTimers());

it('hides only during actual playback, restores for tiny or vertical movement, and cleans up on leave/disable', async () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let media: HTMLVideoElement;
  let paused = true;
  function Harness({ enabled = true }) {
    const hostRef = useRef<HTMLDivElement>(null), mediaRef = useRef<HTMLVideoElement>(null);
    useCardHoverScrub({ enabled, hostRef, mediaRef });
    return createElement('div', { className: 'asset-card' }, createElement('div', { ref: hostRef }, createElement('video', { ref: mediaRef })));
  }
  try {
    await act(() => root.render(createElement(Harness)));
    media = container.querySelector('video')!;
    Object.defineProperties(media, { duration: { configurable: true, value: 10 }, paused: { configurable: true, get: () => paused } });
    vi.spyOn(media, 'pause').mockImplementation(() => { paused = true; });
    const play = vi.spyOn(media, 'play').mockResolvedValue();
    const card = container.querySelector<HTMLElement>('.asset-card')!;
    const move = async (x: number, y: number) => act(() => { card.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y })); });
    const idle = async () => act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await move(50, 50); await idle();
    expect(play).toHaveBeenCalled();
    expect(card.classList.contains('is-hover-playing')).toBe(false);
    await act(() => { paused = false; media.dispatchEvent(new Event('playing')); });
    expect(card.classList.contains('is-hover-playing')).toBe(true);
    await move(51, 50);
    expect(card.classList.contains('is-hover-playing')).toBe(false);
    await idle();
    expect(card.classList.contains('is-hover-playing')).toBe(true);
    await move(51, 51);
    expect(card.classList.contains('is-hover-playing')).toBe(false);
    await idle();
    await act(() => { card.dispatchEvent(new PointerEvent('pointerleave')); });
    await idle();
    expect(card.classList.contains('is-hover-playing')).toBe(false);
    await move(51, 52); await idle();
    expect(card.classList.contains('is-hover-playing')).toBe(true);
    await act(() => root.render(createElement(Harness, { enabled: false })));
    expect(card.classList.contains('is-hover-playing')).toBe(false);
  } finally { await act(() => root.unmount()); container.remove(); }
});
