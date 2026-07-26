/**
 * CANVAS-021 / Serpent-32p diagnostics.
 *
 * Dev: logs by default. Disable: localStorage.setItem('SERPENT_REFLOW_DEBUG', '0')
 * Force on in prod: localStorage.setItem('SERPENT_REFLOW_DEBUG', '1')
 */

const LOG_PREFIX = "[canvas-reflow]";
const SESSION_LOG_KEY = "SERPENT_REFLOW_LOG";
const SESSION_LOG_MAX = 200;

function reflowDebugEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  const flag = localStorage.getItem("SERPENT_REFLOW_DEBUG");
  if (flag === "0") return false;
  if (flag === "1") return true;
  return import.meta.env.DEV;
}

function persistReflowLog(event: string, data?: Record<string, unknown>): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const raw = sessionStorage.getItem(SESSION_LOG_KEY);
    const lines: unknown[] = raw ? JSON.parse(raw) : [];
    lines.push({ t: Date.now(), event, ...(data ?? {}) });
    if (lines.length > SESSION_LOG_MAX) {
      lines.splice(0, lines.length - SESSION_LOG_MAX);
    }
    sessionStorage.setItem(SESSION_LOG_KEY, JSON.stringify(lines));
  } catch {
    // ignore quota / parse errors
  }
}

export function reflowDebug(
  event: string,
  data?: Record<string, unknown>,
): void {
  if (!reflowDebugEnabled()) return;
  persistReflowLog(event, data);
  if (data) {
    console.log(LOG_PREFIX, event, data);
  } else {
    console.log(LOG_PREFIX, event);
  }
}

export function summarizeReflowSnapshot(
  snapshot: {
    scrollLeft: number;
    scrollTop: number;
    anchor: { assetId: string; clientX: number; clientY: number } | null;
  } | null,
): Record<string, unknown> | null {
  if (!snapshot) return null;
  return {
    scrollLeft: snapshot.scrollLeft,
    scrollTop: snapshot.scrollTop,
    anchorAssetId: snapshot.anchor?.assetId ?? null,
    anchorClientY: snapshot.anchor?.clientY ?? null,
  };
}

/** Log unexpected scroll-to-top while a reflow restore is armed. */
export function installCanvasReflowScrollSpy(
  canvas: HTMLElement,
  isArmed: () => boolean,
): () => void {
  if (!reflowDebugEnabled()) return () => undefined;

  let lastScrollTop = canvas.scrollTop;
  const onScroll = () => {
    const top = canvas.scrollTop;
    if (top === 0 && lastScrollTop > 48) {
      reflowDebug(
        isArmed()
          ? "scroll-jumped-to-top-while-armed"
          : "scroll-jumped-to-top",
        {
          previousScrollTop: lastScrollTop,
          scrollHeight: canvas.scrollHeight,
          clientHeight: canvas.clientHeight,
          armed: isArmed(),
        },
      );
    }
    lastScrollTop = top;
  };

  const originalScrollTo = canvas.scrollTo.bind(canvas);
  canvas.scrollTo = ((...args: Parameters<HTMLElement["scrollTo"]>) => {
    const before = canvas.scrollTop;
    originalScrollTo(...args);
    const after = canvas.scrollTop;
    if (before > 48 && after === 0) {
      reflowDebug(
        isArmed() ? "scrollTo-top-while-armed" : "scrollTo-top",
        {
          before,
          args: [...args],
          armed: isArmed(),
          stack: new Error("scrollTo caller").stack,
        },
      );
    }
  }) as typeof canvas.scrollTo;

  canvas.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    canvas.removeEventListener("scroll", onScroll);
    canvas.scrollTo = originalScrollTo;
  };
}
