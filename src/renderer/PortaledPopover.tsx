/**
 * Portals dimension/toolbar popovers to document.body so they escape the
 * workspace stacking context (z-index:0 + isolation) and are not painted
 * under the inspector/navigation panes (MENU-015 / Serpent-iihv).
 */

import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { PopoverSurface, type PopoverSurfaceProps } from "./ui/patterns";

type AnchorRect = {
  top: number;
  left: number;
  width: number;
};

function readAnchorRect(anchor: HTMLElement | null): AnchorRect | null {
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  return {
    top: rect.bottom + 6,
    left: rect.left,
    width: rect.width,
  };
}

export type PortaledPopoverProps = PopoverSurfaceProps & {
  /** Element that owns the popover (usually the dimension button host). */
  readonly anchorRef: RefObject<HTMLElement | null>;
  /** Prefer right-align when the panel would overflow the viewport. */
  readonly preferRight?: boolean;
};

export function PortaledPopover({
  anchorRef,
  preferRight = false,
  className,
  style,
  children,
  ...rest
}: PortaledPopoverProps): ReactNode {
  const surfaceRef = useRef<HTMLDivElement>(null);
  // Reading anchorRef inside the useState initializer violates
  // react-hooks/refs (refs must not be read during render); the layout
  // effect below performs the first measure instead.
  const [coords, setCoords] = useState<AnchorRect | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const next = readAnchorRect(anchorRef.current);
      if (!next) return;
      // Flip horizontally when the panel would clip past the right edge.
      const surfaceWidth = surfaceRef.current?.offsetWidth ?? 320;
      const maxLeft = Math.max(8, window.innerWidth - surfaceWidth - 8);
      let left = preferRight
        ? (anchorRef.current?.getBoundingClientRect().right ?? next.left) -
          surfaceWidth
        : next.left;
      left = Math.min(Math.max(8, left), maxLeft);
      setCoords({ ...next, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, preferRight]);

  if (!coords || typeof document === "undefined") return null;

  return createPortal(
    <PopoverSurface
      {...rest}
      className={className}
      data-dimension-filter-popover=""
      ref={surfaceRef}
      style={{
        ...style,
        position: "fixed",
        top: coords.top,
        left: coords.left,
        right: "auto",
        zIndex: "var(--ui-layer-popover)",
      }}
    >
      {children}
    </PopoverSurface>,
    document.body,
  );
}
