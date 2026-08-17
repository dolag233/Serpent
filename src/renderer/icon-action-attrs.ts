/**
 * REQ-SHELL-013: icon-only controls need an accessible name plus a hover tip.
 * Visual tips are rendered by `HoverTipHost` from `data-hover-tip` (portal,
 * delayed, same stacking tier as context menus). Native `title` is omitted —
 * it fights the custom tip and is unreliable under Electron drag regions.
 */
export function iconActionAttrs(label: string): {
  readonly 'aria-label': string;
  readonly 'data-hover-tip': string;
} {
  return {
    'aria-label': label,
    'data-hover-tip': label,
  };
}
