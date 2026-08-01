import { type ReactNode } from "react";

export type IconName =
  | "activity"
  | "archive"
  | "box"
  | "chevron"
  | "chevron-left"
  | "chevron-right"
  | "clipboard"
  | "clock"
  | "close"
  | "collection"
  | "collapse-left"
  | "collapse-right"
  | "panel-left"
  | "panel-left-close"
  | "panel-right"
  | "panel-right-close"
  | "download"
  | "edit"
  | "eye"
  | "eye-off"
  | "file"
  | "fit-window"
  | "folder"
  | "folder-tree"
  | "folders"
  | "fullscreen"
  | "fullscreen-exit"
  | "github"
  | "globe"
  | "grid"
  | "heart"
  | "info"
  | "link"
  | "link-off"
  | "loader"
  | "menu"
  | "plus"
  | "refresh"
  | "undo"
  | "rotate-cw"
  | "flip-horizontal"
  | "flip-vertical"
  | "search"
  | "settings"
  | "sliders"
  | "smart"
  | "sort-asc"
  | "sort-desc"
  | "star"
  | "tag"
  | "trash"
  | "upload"
  | "warning";

const iconPaths: Record<IconName, ReactNode> = {
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  archive: (
    <>
      <path d="M4 7h16v12H4z" />
      <path d="M3 4h18v3H3zM9 11h6" />
    </>
  ),
  box: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  clipboard: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5" />
      <path d="M4 16v4h16v-4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.4 2.5 3.7 5.6 3.7 9s-1.3 6.5-3.7 9c-2.4-2.5-3.7-5.6-3.7-9S9.6 5.5 12 3Z" />
    </>
  ),
  sliders: (
    <>
      <path d="M3 6h9.6M18.4 6H21M3 12h2.6M11.4 12H21M3 18h11.6M19.4 18H21" />
      <circle cx="16" cy="6" r="2.2" />
      <circle cx="8" cy="12" r="2.2" />
      <circle cx="17" cy="18" r="2.2" />
    </>
  ),
  // REQ-PREF-001: general settings entry point in the browse area — classic
  // outlined gear, distinct from the filter/sort "sliders" glyph.
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3" />
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
  // Lucide-style panel pair: filled rail = open; chevron = close action.
  "panel-left": (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M4 4h5v16H4z" fill="currentColor" opacity="0.35" stroke="none" />
    </>
  ),
  "panel-left-close": (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M4 4h5v16H4z" fill="currentColor" opacity="0.35" stroke="none" />
      <path d="m16 9-3 3 3 3" />
    </>
  ),
  "panel-right": (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M15 4v16" />
      <path d="M15 4h5v16h-5z" fill="currentColor" opacity="0.35" stroke="none" />
    </>
  ),
  "panel-right-close": (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M15 4v16" />
      <path d="M15 4h5v16h-5z" fill="currentColor" opacity="0.35" stroke="none" />
      <path d="m8 9 3 3-3 3" />
    </>
  ),
  edit: (
    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  ),
  eye: (
    <>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5" />
    </>
  ),
  // Distinct from fullscreen-exit (inward corner brackets): framed box +
  // crosshair reads as “fit / center in window”.
  "fit-window": (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M12 7.5v9M7.5 12h9" />
    </>
  ),
  folder: <path d="M3 6.5h7l2 2h9v10H3z" />,
  // Expand-into-descendants (REQ-FOLDER-009): two stacked folders — reads as
  // "this folder and the ones inside", not a plain chevron.
  folders: (
    <>
      <path d="M4 9h6.2l1.4 1.4H15v7.1H4z" />
      <path d="M8 5.5h6.2l1.4 1.4H20v7.6h-4.2" />
    </>
  ),
  "folder-tree": (
    <>
      <path d="M3 5.5h6.2l1.6 1.6H15v5.4H3z" />
      <path d="M8 12.5v2.2" />
      <path d="M8 14.7h3.4l1.4 1.3H21v5.5H8z" />
    </>
  ),
  // Corners pointing outward — enter fullscreen.
  fullscreen: (
    <>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </>
  ),
  // Corners pointing inward — exit fullscreen.
  "fullscreen-exit": (
    <>
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M9 20v-5H4" />
      <path d="M15 20v-5h5" />
    </>
  ),
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
  loader: (
    <>
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M4.93 4.93l2.83 2.83" />
      <path d="M16.24 16.24l2.83 2.83" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="M4.93 19.07l2.83-2.83" />
      <path d="M16.24 7.76l2.83-2.83" />
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
  github: (
    <path
      d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.729.084-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.604-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.63-5.373-12-12-12"
      fill="currentColor"
      stroke="none"
    />
  ),
  undo: (
    <>
      <path d="M9 7 4 12l5 5" />
      <path d="M4 12h9a7 7 0 0 1 7 7" />
    </>
  ),
  "rotate-cw": (
    <>
      <path d="M20 7v5h-5" />
      <path d="M18.4 16a8 8 0 1 1 1.3-8.5L20 12" />
      <path d="M12 8v8M8 12h8" opacity="0.45" />
    </>
  ),
  "flip-horizontal": (
    <>
      <path d="M12 3v18" strokeDasharray="2 2" />
      <path d="m10 6-6 6 6 6V6ZM14 6l6 6-6 6V6Z" />
    </>
  ),
  "flip-vertical": (
    <>
      <path d="M3 12h18" strokeDasharray="2 2" />
      <path d="m6 10 6-6 6 6H6ZM6 14l6 6 6-6H6Z" />
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
  "sort-asc": (
    <>
      <path d="M8 20V8" />
      <path d="m4.5 11.5 3.5-3.5 3.5 3.5" />
      <path d="M13 7h7M13 12h5M13 17h3" />
    </>
  ),
  "sort-desc": (
    <>
      <path d="M8 4v12" />
      <path d="m4.5 12.5 3.5 3.5 3.5-3.5" />
      <path d="M13 7h3M13 12h5M13 17h7" />
    </>
  ),
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
