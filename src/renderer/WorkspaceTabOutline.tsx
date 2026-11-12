import { useLayoutEffect, useState, type ReactNode } from "react";
import {
  workspaceTabOutlineFillPath,
  workspaceTabOutlinePath,
} from "./workspace-tab-outline-path";

const FALLBACK_SCOOP = 18;
const FALLBACK_RADIUS = 14;
/** Half of the 1px chrome stroke — path is inset so the outer edge matches CSS. */
const STROKE_INSET = 0.5;
/** Fill extends this many px below scoop tips to cover the panel top border. */
const FILL_BOTTOM_EXTRA = 1;

function readPx(raw: string, fallback: number): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Active-tab chrome: SVG fill (covers panel top border under tab) + open
 * stroke for scoops/sides/top. Tab and panel share the same 1px stroke;
 * the seam mask ends at the SVG tip centers so their horizontal edges meet.
 */
export function WorkspaceTabOutline(): ReactNode {
  const [host, setHost] = useState<SVGSVGElement | null>(null);
  const [box, setBox] = useState<{
    w: number;
    h: number;
    scoop: number;
    radius: number;
  } | null>(null);

  useLayoutEffect(() => {
    const tab = host?.parentElement;
    if (!tab) return;
    const tabs = tab.closest(".workspace-tabs");

    const measure = () => {
      const cs = getComputedStyle(tab);
      const tcs = tabs ? getComputedStyle(tabs) : null;
      // The scoop is a calc() (scaled by the corner-radius tier), so resolve
      // it through layout instead of parsing the custom property text.
      let scoop = readPx(tcs?.getPropertyValue("--workspace-tab-scoop") ?? "", Number.NaN);
      if (!Number.isFinite(scoop) && tabs) {
        const probe = document.createElement("span");
        probe.style.cssText = "position:absolute;visibility:hidden;height:0;width:var(--workspace-tab-scoop)";
        tabs.appendChild(probe);
        scoop = probe.getBoundingClientRect().width;
        probe.remove();
      }
      if (!Number.isFinite(scoop)) scoop = FALLBACK_SCOOP;
      const radius = readPx(cs.borderTopLeftRadius, FALLBACK_RADIUS);
      const rect = tab.getBoundingClientRect();

      const workspace = tab
        .closest(".app-shell")
        ?.querySelector(":scope > .workspace") as HTMLElement | null;

      let faceH: number;
      if (workspace) {
        const wr = workspace.getBoundingClientRect();
        faceH = Math.max(wr.top + 0.5 - rect.top, scoop + 1);
        const leftTip = rect.left - scoop + STROKE_INSET - wr.left;
        const rightTip = rect.right + scoop - STROKE_INSET - wr.left;
        workspace.style.setProperty(
          "--tab-seam-hole-left",
          `${Math.max(0, leftTip)}px`,
        );
        workspace.style.setProperty(
          "--tab-seam-hole-right",
          `${Math.max(0, rightTip)}px`,
        );
      } else {
        const padBottom = readPx(cs.paddingBottom, 0);
        faceH = Math.max(rect.height - padBottom, scoop + 1);
      }

      setBox({
        w: rect.width,
        h: faceH,
        scoop,
        radius,
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(tab);
    if (tabs) ro.observe(tabs);
    const workspace = tab
      .closest(".app-shell")
      ?.querySelector(":scope > .workspace") as HTMLElement | null;
    if (workspace) ro.observe(workspace);
    // Scrolling the strip moves the tab without changing its size.
    tabs?.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    // Corner-radius tier changes restyle the tab without resizing it.
    const mo = new MutationObserver(measure);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-radius"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
      tabs?.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      workspace?.style.removeProperty("--tab-seam-hole-left");
      workspace?.style.removeProperty("--tab-seam-hole-right");
    };
  }, [host]);

  const S = box?.scoop ?? FALLBACK_SCOOP;
  const h = box?.h ?? 0;
  const w = box?.w ?? 0;
  const strokePath =
    box === null
      ? ""
      : workspaceTabOutlinePath(w, h, S, box.radius, STROKE_INSET);
  const fillPath =
    box === null
      ? ""
      : workspaceTabOutlineFillPath(
          w,
          h,
          S,
          box.radius,
          STROKE_INSET,
          FILL_BOTTOM_EXTRA,
        );
  const vbW = w + 2 * S;
  const vbH = h + FILL_BOTTOM_EXTRA;

  return (
    <svg
      ref={setHost}
      className="workspace-tab-outline"
      aria-hidden="true"
      focusable="false"
      width={box ? vbW : undefined}
      height={box ? vbH : undefined}
      viewBox={box ? `${-S} 0 ${vbW} ${vbH}` : undefined}
    >
      {box ? (
        <>
          <path className="workspace-tab-outline-fill" d={fillPath} />
          <path className="workspace-tab-outline-path" d={strokePath} />
        </>
      ) : null}
    </svg>
  );
}
