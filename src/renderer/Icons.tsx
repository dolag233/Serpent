import { type ReactNode } from "react";

export type IconName =
  | "archive"
  | "chevron"
  | "chevron-left"
  | "chevron-right"
  | "clock"
  | "close"
  | "collection"
  | "collapse-left"
  | "collapse-right"
  | "edit"
  | "file"
  | "folder"
  | "grid"
  | "heart"
  | "info"
  | "link"
  | "link-off"
  | "menu"
  | "plus"
  | "refresh"
  | "search"
  | "smart"
  | "star"
  | "tag"
  | "trash"
  | "upload"
  | "warning";

const iconPaths: Record<IconName, ReactNode> = {
  archive: (
    <>
      <path d="M4 7h16v12H4z" />
      <path d="M3 4h18v3H3zM9 11h6" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  "chevron-left": <path d="m15 18-6-6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  close: <path d="m7 7 10 10M17 7 7 17" />,
  collection: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="m8 14 3-3 5 5 2-2 2 2" />
    </>
  ),
  "collapse-left": (
    <>
      <path d="M5 4h14v16H5zM10 4v16" />
      <path d="m15 9-3 3 3 3" />
    </>
  ),
  "collapse-right": (
    <>
      <path d="M5 4h14v16H5zM14 4v16" />
      <path d="m9 9 3 3-3 3" />
    </>
  ),
  edit: (
    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5" />
    </>
  ),
  folder: <path d="M3 6.5h7l2 2h9v10H3z" />,
  grid: (
    <>
      <rect x="4" y="4" width="6" height="6" />
      <rect x="14" y="4" width="6" height="6" />
      <rect x="4" y="14" width="6" height="6" />
      <rect x="14" y="14" width="6" height="6" />
    </>
  ),
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.8 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
    </>
  ),
  "link-off": (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
      <line x1="4" y1="4" x2="20" y2="20" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M18.4 16a8 8 0 1 1 1.3-8.5L20 12" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  /* REQ-CANVAS-006: AI entry points use a four-point sparkles glyph drawn in
     the same stroke style as the rest of the set — the old path was a
     five-point star that read as "favorites" and duplicated `star`. */
  smart: (
    <>
      <path d="M10 4l1.8 4.2L16 10l-4.2 1.8L10 16l-1.8-4.2L4 10l4.2-1.8Z" />
      <path d="M18 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z" />
    </>
  ),
  star: (
    <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3 1.2-6.9-5-4.9 6.9-1z" />
  ),
  tag: <path d="M4 5h7l9 9-6 6-9-9zM8 8h.01" />,
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m0 0L7 9m5-5 5 5" />
      <path d="M4 14v6h16v-6" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3 2.8 20h18.4z" />
      <path d="M12 9v5m0 3h.01" />
    </>
  ),
};

export function Icon({ name, size = 16, color }: { name: IconName; size?: number; color?: string }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      style={color ? { color } : undefined}
      viewBox="0 0 24 24"
      width={size}
      height={size}
    >
      {iconPaths[name]}
    </svg>
  );
}
