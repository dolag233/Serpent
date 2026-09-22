import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { isImeKeyboardEvent } from "./ime-safe-dismiss";
import {
  handleRovingListKeyDown,
  ROVING_OPTION_SELECTOR,
} from "./roving-list-keyboard";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";
import {
  VIDEO_PLAYBACK_RATES,
  type VideoPlaybackRate,
} from "./video-player-controls";

/**
 * Viewer transport rate picker (Serpent-1a846c).
 *
 * Native `<select>` was rejected (VIEWER-023 / Serpent-gplm): the OS popup
 * ignores theme tokens. Cycling only "faster" then made slow-motion
 * unreachable. This control reuses `ui-menu-surface` options, opens upward
 * so the bottom chrome does not clip it, and keeps X/C stepping on the same
 * discrete list.
 */
export function VideoPlaybackRateSelect({
  value,
  onChange,
  onInteract,
}: {
  readonly value: VideoPlaybackRate;
  readonly onChange: (rate: VideoPlaybackRate) => void;
  readonly onInteract?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const rateLabel = t("preview.playbackRateOption", { rate: value });
  const triggerLabel = `${t("preview.playbackRate")}: ${rateLabel}`;

  function closeList(restoreTriggerFocus: boolean) {
    setOpen(false);
    if (restoreTriggerFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const host = hostRef.current;
      if (!host || !(event.target instanceof Element)) return;
      if (host.contains(event.target)) return;
      closeList(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeList(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    const raf = requestAnimationFrame(() => {
      const list = document.getElementById(listId);
      if (!(list instanceof HTMLElement)) return;
      const selected = list.querySelector<HTMLElement>(
        `${ROVING_OPTION_SELECTOR}[aria-selected="true"]`,
      );
      if (selected) {
        selected.focus();
        return;
      }
      list
        .querySelector<HTMLElement>(ROVING_OPTION_SELECTOR)
        ?.focus();
    });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      cancelAnimationFrame(raf);
    };
  }, [listId, open]);

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (isImeKeyboardEvent(event.nativeEvent)) return;
    const result = handleRovingListKeyDown({
      key: event.key,
      container: event.currentTarget,
      itemSelector: ROVING_OPTION_SELECTOR,
    });
    if (!result.handled) return;
    event.preventDefault();
    event.stopPropagation();
    if (result.action === "escape") closeList(true);
  }

  function pick(next: VideoPlaybackRate) {
    onChange(next);
    closeList(true);
  }

  return (
    <div
      className={`preview-video-rate-host${open ? " is-open" : ""}`}
      ref={hostRef}
    >
      <button
        aria-controls={open ? listId : undefined}
        aria-expanded={open || undefined}
        aria-haspopup="listbox"
        className="preview-video-rate"
        onClick={() => {
          onInteract?.();
          if (open) closeList(true);
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (open) return;
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          event.stopPropagation();
          onInteract?.();
          setOpen(true);
        }}
        ref={triggerRef}
        tabIndex={VIEWER_CHROME_TAB_INDEX}
        type="button"
        {...iconActionAttrs(triggerLabel)}
      >
        {rateLabel}
      </button>
      {open ? (
        <div
          aria-label={t("preview.playbackRateAria")}
          className="ui-menu-surface preview-video-rate-menu"
          id={listId}
          onKeyDown={onListKeyDown}
          role="listbox"
        >
          {VIDEO_PLAYBACK_RATES.map((rate) => (
            <button
              aria-selected={rate === value}
              className={rate === value ? "is-selected" : undefined}
              key={rate}
              onClick={() => pick(rate)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              {t("preview.playbackRateOption", { rate })}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
