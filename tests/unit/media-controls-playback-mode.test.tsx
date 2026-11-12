// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../src/renderer/i18n';
import { VideoPlayerControls } from '../../src/renderer/VideoPlayerControls';
import { AudioPlayerControls } from '../../src/renderer/AudioPlayerControls';
import type { MediaPlaybackMode } from '../../src/renderer/media-playback-mode';

vi.mock('../../src/renderer/use-viewer-zoom-pan', () => ({ useViewerZoomPan: () => ({
  fitToWindow: vi.fn(), measureAndFit: vi.fn(), view: { scale: 1, x: 0, y: 0 }, viewportPointerHandlers: {}, viewportRef: { current: null },
}) }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it.each(['audio', 'video'] as const)('%s exposes mode switching and advances only on sequential, active playback', async (type) => {
  const ended = vi.fn();
  const changeMode = vi.fn();
  async function render(mode: MediaPlaybackMode, autoPlay = true) {
    const props = { src: '/fixture', muted: true, volume: 0, keyboardShortcutsDisabled: true, onError: vi.fn(), onMutedChange: vi.fn(), onVolumeChange: vi.fn(), playbackMode: mode, autoPlay, onEnded: ended, onPlaybackModeChange: changeMode };
    await act(() => root.render(<LocaleProvider initialPreference="en">{type === 'video' ? <VideoPlayerControls {...props} onFullscreen={vi.fn()} /> : <AudioPlayerControls {...props} />}</LocaleProvider>));
  }
  await render('repeat-one');
  const media = host.querySelector(type)!;
  expect(media.loop).toBe(true);
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Playback mode: Repeat one (click to switch)"]')!;
  expect(button).not.toBeNull();
  await act(() => button.click());
  expect(changeMode).toHaveBeenCalledWith('sequential');
  await render('stop');
  expect(media.loop).toBe(false);
  await act(() => media.dispatchEvent(new Event('ended')));
  expect(ended).not.toHaveBeenCalled();
  await render('sequential');
  await act(() => media.dispatchEvent(new Event('ended')));
  expect(ended).toHaveBeenCalledOnce();
  await render('sequential', false);
  await act(() => media.dispatchEvent(new Event('ended')));
  expect(ended).toHaveBeenCalledOnce();
});
