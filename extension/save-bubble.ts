/**
 * 页面内保存反馈气泡：拖拽树（radial-menu.ts）与右键菜单保存（background.ts
 * → content-script.ts）共用。自建 shadow host，pointer-events 全透传，
 * 不拦截页面交互。样式与 radial-menu 原内联气泡一致。
 */

let hostEl: HTMLDivElement | null = null;
let bubbleTimer = 0;

const STYLE_TEXT = `
  :host { all: initial; }
  .bubble {
    position: fixed; z-index: 2147483647; pointer-events: none;
    background: rgba(24, 26, 28, 0.94); color: #f5f5f5;
    border-radius: 999px; padding: 9px 16px;
    font: 12px/1.5 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    opacity: 0; transition: opacity 180ms, transform 180ms;
    transform: translateX(-50%) translateY(6px);
    max-width: 320px; white-space: normal; text-align: center;
  }
  .bubble.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .bubble .msg { display: block; opacity: 0.72; font-size: 11px; }
`;

function ensureHost(): HTMLDivElement {
  if (hostEl) return hostEl;
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '0',
    height: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE_TEXT;
  root.appendChild(style);
  document.documentElement.appendChild(host);
  hostEl = host;
  return host;
}

function renderBubble(x: number, y: number, title: string, message?: string): void {
  const root = ensureHost().shadowRoot;
  if (!root) return;
  let bubble = root.querySelector<HTMLDivElement>('.bubble');
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.className = 'bubble';
    root.appendChild(bubble);
  }
  bubble.replaceChildren();
  const titleNode = document.createElement('span');
  titleNode.textContent = title;
  bubble.appendChild(titleNode);
  if (message) {
    const messageNode = document.createElement('span');
    messageNode.className = 'msg';
    messageNode.textContent = message;
    bubble.appendChild(messageNode);
  }
  bubble.style.left = `${Math.min(Math.max(x, 170), window.innerWidth - 170)}px`;
  bubble.style.top = `${Math.min(y + 18, window.innerHeight - 70)}px`;
  bubble.classList.add('show');
  window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => bubble?.classList.remove('show'), 2200);
}

/** 在指定坐标显示气泡（拖拽保存等指针上下文）。 */
export function showSaveBubble(
  x: number,
  y: number,
  title: string,
  message?: string,
): void {
  renderBubble(x, y, title, message);
}

/** 视口顶部居中的提示气泡（右键菜单保存等无指针坐标的上下文）。 */
export function showSaveToast(title: string, message?: string): void {
  renderBubble(window.innerWidth / 2, 48, title, message);
}
