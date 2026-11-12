/**
 * Read the colours the real app is painting right now, so the custom-theme
 * editor and its preview use exactly the same surfaces (a93). Island
 * surfaces are scoped to `.app-shell[data-shell-layout="islands"]`, so the
 * probe is mounted inside the shell when it exists.
 */
export type SampledThemeColors = {
  readonly backdrop: string;
  readonly side: string;
  readonly canvas: string;
  readonly card: string;
  readonly border: string;
  /** Selection wash (nav active row) as seen over the side panel. */
  readonly select: string;
  /** Main-panel toolstrip as seen over the main panel. */
  readonly tool: string;
  /** Inspector text field as seen over the side panel. */
  readonly field: string;
};

let paintContext: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour → `#rrggbb` (alpha composited over `over`, default white). */
export function cssColorToHex(color: string, over = '#ffffff'): string | null {
  if (typeof document === 'undefined') return null;
  if (paintContext === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    paintContext = canvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = paintContext;
  if (!ctx) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = over;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = '#000000';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
}

function probe(host: Element, background: string): string {
  const el = document.createElement('span');
  el.style.cssText = `position:absolute;width:0;height:0;visibility:hidden;background-color:${background}`;
  host.appendChild(el);
  const value = getComputedStyle(el).backgroundColor;
  el.remove();
  return value;
}

export function sampleThemeColors(): SampledThemeColors | null {
  if (typeof document === 'undefined') return null;
  const shell = document.querySelector('.app-shell[data-shell-layout="islands"]');
  const host = shell ?? document.body;
  const side = probe(host, 'var(--island-side, var(--ui-surface-pane))');
  const canvas = probe(host, 'var(--island-canvas, var(--ui-surface-raised))');
  const realCard = shell?.querySelector('.asset-card');
  const card = realCard ? getComputedStyle(realCard).backgroundColor : canvas;
  const sideHex = cssColorToHex(side) ?? '#ffffff';
  const canvasHex = cssColorToHex(canvas) ?? '#ffffff';
  const realTool = shell?.querySelector('.workspace-toolstrip');
  const realField = shell?.querySelector('.inspector-pane .text-field, .inspector-pane textarea, .inspector-pane input');
  return {
    backdrop: cssColorToHex(probe(host, 'var(--island-backdrop, var(--ui-surface-canvas))')) ?? '#ffffff',
    side: sideHex,
    canvas: cssColorToHex(canvas) ?? '#ffffff',
    card: cssColorToHex(card, cssColorToHex(canvas) ?? '#ffffff') ?? '#ffffff',
    // Island borders are translucent ink; show them as seen on the panels.
    border: cssColorToHex(probe(host, 'var(--island-panel-stroke, var(--island-border, var(--ui-border-subtle)))'), sideHex) ?? '#cccccc',
    select: cssColorToHex(probe(host, 'var(--island-select, var(--ui-action-accent-soft))'), sideHex) ?? sideHex,
    tool: realTool ? (cssColorToHex(getComputedStyle(realTool).backgroundColor, canvasHex) ?? canvasHex) : canvasHex,
    field: realField ? (cssColorToHex(getComputedStyle(realField).backgroundColor, sideHex) ?? sideHex) : sideHex,
  };
}
