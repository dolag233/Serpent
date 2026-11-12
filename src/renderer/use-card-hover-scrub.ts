import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import {
  applyCardHoverScrubToMedia,
  CARD_HOVER_SCRUB_SETTLE_MS,
  cardHoverScrubRatioFromClientX,
  isSignificantHoverScrubMove,
  shouldShowCardHoverPlayhead,
  type CardHoverScrubIntent,
} from "./asset-card-hover-scrub";
import { playheadLeftPercent } from "./audio-waveform-timeline";

function resolvePointerRoot(host: HTMLElement | null): HTMLElement | null {
  return host?.closest(".asset-card") ?? host;
}

/**
 * Hover preview on browse cards: pointer X seeks the timeline; after 500ms
 * of little movement, playback starts and the playhead hides.
 */
export function useCardHoverScrub(input: {
  enabled: boolean;
  hostRef: RefObject<HTMLElement | null>;
  mediaRef: RefObject<HTMLMediaElement | null>;
}): {
  playheadPercent: number;
  showPlayhead: boolean;
} {
  const { enabled, hostRef, mediaRef } = input;
  const lastClientXRef = useRef<number | null>(null);
  const [ratio, setRatio] = useState(0);
  const [intent, setIntent] = useState<CardHoverScrubIntent>("seek");

  useLayoutEffect(() => {
    const root = resolvePointerRoot(hostRef.current);
    if (!root) return;
    const remember = (event: PointerEvent) => {
      lastClientXRef.current = event.clientX;
    };
    root.addEventListener("pointermove", remember);
    root.addEventListener("pointerenter", remember);
    return () => {
      root.removeEventListener("pointermove", remember);
      root.removeEventListener("pointerenter", remember);
    };
  }, [hostRef]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let lastSignificantX = lastClientXRef.current;
    let currentRatio = 0;
    let currentIntent: CardHoverScrubIntent = "seek";
    let settleTimer = 0;
    let cursorTimer = 0;
    let lastPointer: { x: number; y: number } | null = null;
    const root = resolvePointerRoot(hostRef.current);
    const media = mediaRef.current;
    let stationary = false;
    let pointerInside = true;
    let playing = Boolean(media && !media.paused && media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
    const updateCursor = () => {
      root?.classList.toggle('is-hover-playing', playing && pointerInside && stationary && currentIntent === 'play' && Boolean(media && !media.error && !media.paused && !media.ended));
    };
    const onPlaying = () => { playing = true; updateCursor(); };
    const onStopped = () => { playing = false; updateCursor(); };
    const wakeCursor = () => {
      stationary = false;
      root?.classList.remove('is-hover-playing');
      window.clearTimeout(cursorTimer);
      cursorTimer = window.setTimeout(() => { stationary = true; updateCursor(); }, CARD_HOVER_SCRUB_SETTLE_MS);
    };

    const apply = (nextIntent: CardHoverScrubIntent, nextRatio: number) => {
      currentRatio = nextRatio;
      currentIntent = nextIntent;
      setRatio(nextRatio);
      setIntent(nextIntent);
      const media = mediaRef.current;
      if (media) {
        applyCardHoverScrubToMedia(media, {
          ratio: nextRatio,
          intent: nextIntent,
        });
      }
      updateCursor();
    };

    const seekFromClientX = (clientX: number) => {
      const host = hostRef.current;
      if (!host) return;
      const nextRatio = cardHoverScrubRatioFromClientX(
        clientX,
        host.getBoundingClientRect(),
      );
      apply("seek", nextRatio);
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        apply("play", currentRatio);
      }, CARD_HOVER_SCRUB_SETTLE_MS);
    };

    const onLeave = () => { pointerInside = false; window.clearTimeout(cursorTimer); root?.classList.remove("is-hover-playing"); };
    const onPointer = (event: PointerEvent) => {
      pointerInside = true;
      if (!lastPointer || event.clientX !== lastPointer.x || event.clientY !== lastPointer.y) wakeCursor();
      lastPointer = { x: event.clientX, y: event.clientY };
      const clientX = event.clientX;
      lastClientXRef.current = clientX;
      const significant =
        lastSignificantX === null ||
        isSignificantHoverScrubMove(clientX - lastSignificantX);
      if (!significant) return;
      lastSignificantX = clientX;
      seekFromClientX(clientX);
    };

    const onMeta = () => {
      apply(currentIntent, currentRatio);
    };

    root?.addEventListener("pointerleave", onLeave);
    root?.addEventListener("pointermove", onPointer);
    root?.addEventListener("pointerenter", onPointer);
    media?.addEventListener("loadedmetadata", onMeta);
    media?.addEventListener('playing', onPlaying);
    media?.addEventListener('pause', onStopped);
    media?.addEventListener('ended', onStopped);
    media?.addEventListener('error', onStopped);
    wakeCursor();

    if (lastClientXRef.current !== null) {
      lastSignificantX = lastClientXRef.current;
      seekFromClientX(lastClientXRef.current);
    }

    return () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(cursorTimer);
      root?.classList.remove('is-hover-playing');
      root?.removeEventListener('pointerleave', onLeave);
      media?.removeEventListener('playing', onPlaying);
      media?.removeEventListener('pause', onStopped);
      media?.removeEventListener('ended', onStopped);
      media?.removeEventListener('error', onStopped);
      root?.removeEventListener("pointermove", onPointer);
      root?.removeEventListener("pointerenter", onPointer);
      media?.removeEventListener("loadedmetadata", onMeta);
    };
  }, [enabled, hostRef, mediaRef]);

  return {
    playheadPercent: enabled ? playheadLeftPercent(ratio) : 0,
    showPlayhead: enabled && shouldShowCardHoverPlayhead(intent),
  };
}
