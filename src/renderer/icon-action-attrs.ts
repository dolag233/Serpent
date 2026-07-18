/**
 * REQ-SHELL-013: icon-only controls need the same string for assistive tech
 * (`aria-label`) and native hover tooltips (`title`).
 */
export function iconActionAttrs(label: string): {
  readonly 'aria-label': string;
  readonly title: string;
} {
  return { 'aria-label': label, title: label };
}
