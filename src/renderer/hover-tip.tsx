import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';

/** Quiet delay before a hover tip appears (REQ-SHELL-013 follow-up). */
export const HOVER_TIP_SHOW_DELAY_MS = 420;

type TipState = {
  readonly text: string;
  readonly left: number;
  readonly top: number;
};

/**
 * Document-level hover tip host. Mount once near the app root. Any element
 * with `data-hover-tip` participates; the tip renders into `document.body`
 * at the same stacking tier as context menus (styles.css `.hover-tip`).
 */
export function HoverTipHost() {
  const [tip, setTip] = useState<TipState | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const activeElRef = useRef<Element | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };

    const hide = () => {
      clearTimer();
      activeElRef.current = null;
      setTip(null);
    };

    const scheduleShow = (el: Element) => {
      const text = el.getAttribute('data-hover-tip')?.trim();
      if (!text) {
        hide();
        return;
      }
      if (activeElRef.current === el) return;
      clearTimer();
      activeElRef.current = el;
      setTip(null);
      showTimerRef.current = window.setTimeout(() => {
        if (activeElRef.current !== el) return;
        const rect = el.getBoundingClientRect();
        const left = Math.min(
          window.innerWidth - 12,
          Math.max(12, rect.left + rect.width / 2),
        );
        const top = Math.min(window.innerHeight - 8, rect.bottom + 6);
        setTip({ text, left, top });
        showTimerRef.current = null;
      }, HOVER_TIP_SHOW_DELAY_MS);
    };

    const onPointerOver = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest('[data-hover-tip]');
      if (!el || !(el instanceof Element)) {
        if (activeElRef.current) hide();
        return;
      }
      scheduleShow(el);
    };

    const onPointerOut = (event: PointerEvent) => {
      const related = event.relatedTarget;
      if (
        related instanceof Element &&
        activeElRef.current?.contains(related)
      ) {
        return;
      }
      const leaving = event.target;
      if (
        leaving instanceof Element &&
        activeElRef.current &&
        (leaving === activeElRef.current ||
          activeElRef.current.contains(leaving))
      ) {
        hide();
      }
    };

    const onPointerDown = () => hide();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    const onScroll = () => hide();

    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', hide);

    return () => {
      clearTimer();
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip || typeof document === 'undefined') return null;

  const style: CSSProperties = {
    left: tip.left,
    top: tip.top,
    transform: 'translateX(-50%)',
  };

  return createPortal(
    <div className="hover-tip" role="tooltip" style={style}>
      {tip.text}
    </div>,
    document.body,
  );
}
