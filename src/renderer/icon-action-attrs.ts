/**
 * REQ-SHELL-013: icon-only controls need an accessible name plus a hover
 * hint. Native `title` is unreliable under Electron (and blocked when an
 * ancestor uses `-webkit-app-region: drag`); `data-tooltip` drives the CSS
 * hover tip in styles.css.
 */
export function iconActionAttrs(label: string): {
  readonly 'aria-label': string;
  readonly 'data-tooltip': string;
  readonly title: string;
} {
  return {
    'aria-label': label,
    'data-tooltip': label,
    // Keep title as a progressive fallback outside Chromium drag regions.
    title: label,
  };
}
