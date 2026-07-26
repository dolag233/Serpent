import {
  buildSaveMenuFolderHints,
  MAX_TOP_LEVEL_FOLDER_SLOTS,
  splitSaveMenuFolders,
  type ExtensionFolderOption,
} from './folder-menu';
import { findMediaElementAtPoint, type MediaTarget } from './media-target';
import {
  DEFAULT_RADIAL_GEOMETRY,
  RADIAL_TAU,
  RADIAL_TOP,
  armedCrumb,
  buildFolderTree,
  clampCenter,
  crumbForLevel,
  expandRadius,
  isReleaseInRing,
  itemsForLevel,
  midAngle,
  pageCountForLevel,
  radialCrossTriggerRadius,
  rotationForEntry,
  sectorAt,
  type FolderNode,
  type RadialItem,
  type RadialLevel,
  type RadialMenuContext,
} from './radial-menu-model';
import type { SaveIntent } from './save-client';

/**
 * Serpent-6llg / REQ-EXT-005 拖拽径向保存菜单（Hotbox）渲染与拖拽事件。
 * 规格：docs/ui/0002-extension-drag-radial-save-menu.md（v4）。
 * 命中判定全部走几何计算（radial-menu-model），轮盘自身 pointer-events:none，
 * 不拦截原生拖拽事件流；Shadow DOM 隔离页面样式。
 */

const GEOMETRY = DEFAULT_RADIAL_GEOMETRY;
const ROOT_FOLDER_PATH = '根目录';

interface ConnectionStatusResponse {
  kind: 'connected' | 'disconnected';
}

interface FolderListResponse {
  kind: 'ok';
  folders: ExtensionFolderOption[];
  firstLevelFolderIds?: string[];
  recentFolderIds?: string[];
  recentBrowsedFolderIds?: string[];
}

interface FolderListErrorResponse {
  kind: 'rejected' | 'unreachable';
}

interface SaveResponse {
  notification: {
    title: string;
    message: string;
  };
}

function sendRuntimeMessage<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? 'runtime message failed'));
        return;
      }
      resolve(response as T);
    });
  });
}

/* ================= Shadow host ================= */

const STYLE_TEXT = `
  :host { all: initial; }
  .scrim {
    position: fixed; inset: 0; pointer-events: none;
    background: rgba(0, 0, 0, 0.4); opacity: 0;
    transition: opacity 150ms ease-out;
  }
  .scrim.show { opacity: 1; }
  .wheel {
    position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147483647;
    pointer-events: none;
    font: 13px/1.4 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    animation: serpent-wheel-in 130ms ease-out;
  }
  @keyframes serpent-wheel-in {
    from { transform: scale(0.82); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
  .disc {
    position: absolute; left: 0; top: 0; transform: translate(-50%, -50%);
    border-radius: 50%;
    background: rgba(48, 50, 54, 0.62);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.16);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  }
  svg.layer { position: absolute; overflow: visible; display: block; }
  .armed-wedge { fill: rgba(59, 130, 246, 0.78); }
  .back-tint { fill: rgba(255, 255, 255, 0.055); }
  .divider { stroke: rgba(255, 255, 255, 0.13); stroke-width: 1; }
  .band { fill: rgba(59, 130, 246, 0.30); }
  .chev { fill: rgba(255, 255, 255, 0.65); font-size: 11px; }
  .chev.armed { fill: #fff; }
  .sector-label {
    position: absolute; left: 0; top: 0; width: 116px;
    text-align: center; color: #f5f5f5; pointer-events: none;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
    display: flex; flex-direction: column; align-items: center; gap: 2px;
  }
  .sector-label .ico { position: relative; width: 17px; height: 17px; color: rgba(245,245,245,0.92); }
  .sector-label .ico svg { width: 17px; height: 17px; display: block; }
  .sector-label .ico .badge {
    position: absolute; right: -5px; bottom: -3px; width: 9px; height: 9px; display: block;
  }
  .sector-label .txt {
    font-size: 12px; font-weight: 500; line-height: 1.2;
    display: block; max-width: 116px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .sector-label.armed .txt { font-weight: 700; }
  .hub {
    position: absolute; left: 0; top: 0; transform: translate(-50%, -50%);
    border-radius: 50%;
    background: rgba(30, 32, 36, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.18);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: #f5f5f5; pointer-events: none;
  }
  .hub .x { font-size: 17px; line-height: 1; }
  .hub .sub { font-size: 9px; opacity: 0.7; margin-top: 2px; }
  .crumb {
    position: absolute; left: 0; transform: translateX(-50%);
    color: rgba(245, 245, 245, 0.9); font-size: 12px; white-space: nowrap;
    background: rgba(48, 50, 54, 0.72); padding: 3px 12px; border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    pointer-events: none;
  }
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

/* ================= SVG 图标（单色线性，非 emoji） ================= */

function svgIcon(inner: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const ICONS = {
  folder: svgIcon('<path d="M4 8a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>'),
  home: svgIcon('<path d="M4.5 11 12 4.5 19.5 11"/><path d="M6.5 9.5V19h11V9.5"/>'),
  grid: svgIcon('<rect x="4.5" y="4.5" width="6.5" height="6.5" rx="1.2"/><rect x="13" y="4.5" width="6.5" height="6.5" rx="1.2"/><rect x="4.5" y="13" width="6.5" height="6.5" rx="1.2"/><rect x="13" y="13" width="6.5" height="6.5" rx="1.2"/>'),
  back: svgIcon('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>',
};

function iconForItem(item: RadialItem): string {
  if (item.nav === 'back') return ICONS.back;
  if (item.nav === 'page') return ICONS.more;
  if (item.nav === 'expand') return ICONS.grid;
  if (item.folderId === null && item.path === ROOT_FOLDER_PATH) return ICONS.home;
  return ICONS.folder;
}

/* ================= 状态机 ================= */

interface WheelEntry {
  level: RadialLevel;
  page: number;
  cx: number;
  cy: number;
  rotation: number;
}

interface WheelState {
  stack: WheelEntry[];
  armed: number;
  zone: 'hub' | 'ring' | 'none';
  /** 穿越守卫：层级切换后光标须先回到展开半径以内一次才允许下次穿越 */
  canCross: boolean;
  pointer: { x: number; y: number };
  media: MediaTarget;
  context: RadialMenuContext;
}

let shadowRoot: ShadowRoot | null = null;
let scrimEl: HTMLDivElement | null = null;
let wheelEl: HTMLDivElement | null = null;
let state: WheelState | null = null;
let bubbleTimer = 0;

function ensureShadowRoot(): ShadowRoot {
  if (shadowRoot) return shadowRoot;
  const host = document.createElement('div');
  host.setAttribute('data-serpent-radial-menu', 'true');
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
  // 全屏压暗层：轮盘打开时凸显 UI；pointer-events:none 不干扰拖拽事件流
  scrimEl = document.createElement('div');
  scrimEl.className = 'scrim';
  root.appendChild(scrimEl);
  document.documentElement.appendChild(host);
  shadowRoot = root;
  return root;
}

function polar(radius: number, angle: number): [number, number] {
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

function wedgePath(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r0, a0);
  const [x1, y1] = polar(r1, a0);
  const [x2, y2] = polar(r1, a1);
  const [x3, y3] = polar(r0, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} ` +
    `A ${r1} ${r1} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} ` +
    `L ${x3.toFixed(1)} ${y3.toFixed(1)} A ${r0} ${r0} 0 ${large} 0 ${x0.toFixed(1)} ${y0.toFixed(1)} Z`;
}

function current(): WheelEntry {
  const entry = state?.stack[(state?.stack.length ?? 1) - 1];
  if (!entry) throw new Error('radial menu: empty wheel stack');
  return entry;
}

function render(): void {
  const s = state;
  if (!s || !wheelEl) return;
  const entry = current();
  const items = itemsForLevel(entry.level, entry.page, s.context);
  const armedItem = s.zone === 'ring' && s.armed >= 0 ? items[s.armed] : undefined;
  const count = items.length;
  const width = RADIAL_TAU / count;
  const radius = expandRadius(GEOMETRY) + 10;

  const disc = wheelEl.querySelector<HTMLDivElement>('.disc');
  const layer = wheelEl.querySelector<SVGSVGElement>('svg.layer');
  const labels = wheelEl.querySelector<HTMLDivElement>('.labels');
  const hub = wheelEl.querySelector<HTMLDivElement>('.hub');
  const crumb = wheelEl.querySelector<HTMLDivElement>('.crumb');
  if (!disc || !layer || !labels || !hub || !crumb) return;

  wheelEl.style.left = `${entry.cx}px`;
  wheelEl.style.top = `${entry.cy}px`;
  disc.style.width = disc.style.height = `${GEOMETRY.ringOut * 2}px`;
  hub.style.width = hub.style.height = `${(GEOMETRY.hub - 2) * 2}px`;
  crumb.style.top = `${-(GEOMETRY.ringOut + 30)}px`;
  crumb.textContent = armedCrumb(armedItem) ?? crumbForLevel(entry.level, s.context);

  layer.setAttribute('viewBox', `${-radius} ${-radius} ${radius * 2} ${radius * 2}`);
  layer.setAttribute('width', String(radius * 2));
  layer.setAttribute('height', String(radius * 2));
  layer.style.left = `${-radius}px`;
  layer.style.top = `${-radius}px`;

  let svg = '';

  // 展开引导弧（武装可穿越项时）
  if (armedItem?.expandable) {
    const mid = midAngle(s.armed, count, entry.rotation);
    svg += `<path class="band" d="${wedgePath(GEOMETRY.ringOut + 3, expandRadius(GEOMETRY) - 4, mid - width / 2, mid + width / 2)}"/>`;
  }

  // 「返回」与「最近」扇区常驻底（未武装时）
  items.forEach((item, i) => {
    if (i === s.armed) return;
    const mid = midAngle(i, count, entry.rotation);
    if (item.nav === 'back') {
      svg += `<path class="back-tint" d="${wedgePath(GEOMETRY.hub + 1.5, GEOMETRY.ringOut - 1.5, mid - width / 2, mid + width / 2)}"/>`;
    }
  });

  // 武装扇区高亮
  if (armedItem) {
    const mid = midAngle(s.armed, count, entry.rotation);
    svg += `<path class="armed-wedge" d="${wedgePath(GEOMETRY.hub + 1.5, GEOMETRY.ringOut - 1.5, mid - width / 2, mid + width / 2)}"/>`;
  }

  // 分格线
  for (let i = 0; i < count; i += 1) {
    const angle = RADIAL_TOP + i * width - width / 2 + entry.rotation;
    const [x0, y0] = polar(GEOMETRY.hub + 2, angle);
    const [x1, y1] = polar(GEOMETRY.ringOut - 2, angle);
    svg += `<line class="divider" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`;
  }

  // 可穿越 chevron
  items.forEach((item, i) => {
    if (!item.expandable) return;
    const [tx, ty] = polar(GEOMETRY.ringOut - 12, midAngle(i, count, entry.rotation));
    svg += `<text class="chev${i === s.armed ? ' armed' : ''}" x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle">▸</text>`;
  });

  layer.innerHTML = svg;

  // 标签（图标 + 文字）
  const labelRadius = (GEOMETRY.hub + GEOMETRY.ringOut) / 2 + 6;
  labels.innerHTML = items
    .map((item, i) => {
      const [lx, ly] = polar(labelRadius, midAngle(i, count, entry.rotation));
      const badge = '';
      return `<div class="sector-label${i === s.armed ? ' armed' : ''}" style="transform: translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translate(-50%, -50%)">` +
        `<span class="ico">${iconForItem(item)}</span>` +
        `<span class="txt"></span></div>`;
    })
    .join('');
  // 文本走 textContent，避免文件夹名注入 HTML
  const textNodes = labels.querySelectorAll<HTMLSpanElement>('.txt');
  items.forEach((item, i) => {
    const textNode = textNodes[i];
    if (textNode) textNode.textContent = item.label;
  });
}

/* ================= 层级导航 ================= */

function pushLevel(target: RadialLevel, entryAngle: number): void {
  if (!state) return;
  const { x, y } = clampCenter(
    state.pointer.x,
    state.pointer.y,
    window.innerWidth,
    window.innerHeight,
    GEOMETRY,
  );
  state.stack.push({ level: target, page: 0, cx: x, cy: y, rotation: rotationForEntry(entryAngle) });
  state.armed = -1;
  state.canCross = false;
  render();
}

function nextPage(): void {
  if (!state) return;
  const entry = current();
  entry.page = (entry.page + 1) % pageCountForLevel(entry.level, state.context);
  state.armed = -1;
  state.canCross = false;
  render();
}

function goBack(): void {
  if (!state) return;
  if (state.stack.length > 1) state.stack.pop();
  state.armed = -1;
  state.canCross = false;
  render();
}

/* ================= 气泡（提示 / 保存反馈） ================= */

function showBubble(x: number, y: number, title: string, message?: string): void {
  const root = ensureShadowRoot();
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

/* ================= 保存 ================= */

async function requestSave(
  media: MediaTarget,
  targetFolderId: string | null,
  bubbleX: number,
  bubbleY: number,
): Promise<void> {
  const intent: SaveIntent = {
    kind: media.kind,
    sourcePageUrl: window.location.href,
    mediaUrl: media.mediaUrl,
    targetFolderId,
  };
  const response = await sendRuntimeMessage<SaveResponse>({
    type: 'serpent-save-request',
    intent,
  });
  showBubble(bubbleX, bubbleY, response.notification.title, response.notification.message);
}

/* ================= 拖拽事件 ================= */

function onDragOver(event: DragEvent): void {
  const s = state;
  if (!s) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  s.pointer = { x: event.clientX, y: event.clientY };
  const entry = current();
  const dx = event.clientX - entry.cx;
  const dy = event.clientY - entry.cy;
  const distance = Math.hypot(dx, dy);
  const expandVisual = expandRadius(GEOMETRY);
  const crossTrigger = radialCrossTriggerRadius(GEOMETRY);
  if (distance <= crossTrigger) s.canCross = true;

  const items = itemsForLevel(entry.level, entry.page, s.context);
  if (distance < GEOMETRY.hub) {
    s.zone = 'hub';
    s.armed = -1;
  } else {
    s.zone = 'ring';
    const index = sectorAt(Math.atan2(dy, dx), items.length, entry.rotation);
    s.armed = index;
    const item = items[index];
    if (item && item.expandable && distance > crossTrigger && s.canCross) {
      if (item.nav === 'page') nextPage();
      else if (item.nav === 'back') goBack();
      else if (item.target) pushLevel(item.target, midAngle(index, items.length, entry.rotation));
      return;
    }
  }
  render();
}

function onDrop(event: DragEvent): void {
  const s = state;
  if (!s) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const entry = current();
  const dx = event.clientX - entry.cx;
  const dy = event.clientY - entry.cy;
  const distance = Math.hypot(dx, dy);

  // 只有落在扇区环内的松开才执行动作；中心与环外松开一律退出不保存
  if (s.zone === 'ring' && isReleaseInRing(distance, GEOMETRY) && s.armed >= 0) {
    const items = itemsForLevel(entry.level, entry.page, s.context);
    const item = items[s.armed];
    if (item?.nav === 'save') {
      const folderId = item.folderId ?? null;
      const path = item.path ?? ROOT_FOLDER_PATH;
      const media = s.media;
      closeWheel();
      showBubble(event.clientX, event.clientY, `保存到：${path.split('/').join(' / ')}`, '发送中…');
      void requestSave(media, folderId, event.clientX, event.clientY);
      return;
    }
    if (item?.nav === 'expand' && item.target) {
      pushLevel(item.target, midAngle(s.armed, items.length, entry.rotation));
      return;
    }
    if (item?.nav === 'page') {
      nextPage();
      return;
    }
    if (item?.nav === 'back') {
      goBack();
      return;
    }
  }
  closeWheel();
}

function onDragEnd(): void {
  closeWheel();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && state) {
    closeWheel();
  }
}

function attachDragListeners(): void {
  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('drop', onDrop, true);
  document.addEventListener('dragend', onDragEnd, true);
  document.addEventListener('keydown', onKeyDown, true);
}

function detachDragListeners(): void {
  document.removeEventListener('dragover', onDragOver, true);
  document.removeEventListener('drop', onDrop, true);
  document.removeEventListener('dragend', onDragEnd, true);
  document.removeEventListener('keydown', onKeyDown, true);
}

function closeWheel(): void {
  if (!state) return;
  state = null;
  detachDragListeners();
  scrimEl?.classList.remove('show');
  wheelEl?.remove();
  wheelEl = null;
}

function openWheel(clientX: number, clientY: number, media: MediaTarget, context: RadialMenuContext): void {
  const root = ensureShadowRoot();
  wheelEl?.remove();
  wheelEl = document.createElement('div');
  wheelEl.className = 'wheel';
  wheelEl.innerHTML =
    '<div class="disc"></div>' +
    '<svg class="layer" xmlns="http://www.w3.org/2000/svg"></svg>' +
    '<div class="labels"></div>' +
    '<div class="hub"><span class="x">✕</span><span class="sub">取消</span></div>' +
    '<div class="crumb"></div>';
  root.appendChild(wheelEl);
  scrimEl?.classList.add('show');

  const { x, y } = clampCenter(clientX, clientY, window.innerWidth, window.innerHeight, GEOMETRY);
  state = {
    stack: [{ level: { kind: 'root' }, page: 0, cx: x, cy: y, rotation: 0 }],
    armed: -1,
    zone: 'none',
    canCross: true,
    pointer: { x: clientX, y: clientY },
    media,
    context,
  };
  attachDragListeners();
  render();
}

/* ================= 入口 ================= */

const DRAG_GHOST_MAX_SIZE = 96;

/**
 * 自定义拖拽幽灵：把指针下的媒体元素画进 ≤96px 画布缩略图，锚点固定在光标
 * 左上角。原生幽灵是全尺寸快照且按抓取点锚定，会遮住轮盘中心与扇区
 * （2026-07-25 真实浏览器实测反馈）。必须在 dragstart 内同步调用；
 * 绘制或快照失败（跨源/DRM 视频、无内联尺寸 SVG 等）时保持原生幽灵。
 */
export function applyDragGhostThumbnail(event: DragEvent): void {
  const { dataTransfer } = event;
  if (!dataTransfer) return;
  const source = findMediaElementAtPoint(
    document,
    event.clientX,
    event.clientY,
    event.composedPath(),
  );
  if (!source) return;

  const sourceWidth =
    source instanceof HTMLImageElement ? source.naturalWidth : source.videoWidth;
  const sourceHeight =
    source instanceof HTMLImageElement ? source.naturalHeight : source.videoHeight;
  if (sourceWidth <= 0 || sourceHeight <= 0) return;

  const scale = Math.min(1, DRAG_GHOST_MAX_SIZE / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return;
  try {
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
  } catch {
    return; // 跨源/DRM 媒体无法绘制时保持原生幽灵
  }

  // Chrome 要求幽灵元素在文档内且可见——渲染到视口外，dragend 后移除
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    pointerEvents: 'none',
  });
  document.documentElement.appendChild(canvas);
  document.addEventListener('dragend', () => canvas.remove(), {
    capture: true,
    once: true,
  });
  try {
    dataTransfer.setDragImage(canvas, 0, 0);
  } catch {
    canvas.remove(); // 快照失败回退原生幽灵
  }
}

/**
 * dragstart 时调用：先校验连接、取文件夹树与最近列表，再展开轮盘。
 * 异步期间用户已松手（dragend 先于 open 触发）则放弃展开。
 */
export async function startRadialSaveMenu(
  clientX: number,
  clientY: number,
  media: MediaTarget,
): Promise<void> {
  if (state) return;

  let dragEndedEarly = false;
  const earlyEnd = (): void => {
    dragEndedEarly = true;
  };
  document.addEventListener('dragend', earlyEnd, { capture: true, once: true });

  try {
    let connected = false;
    try {
      const status = await sendRuntimeMessage<ConnectionStatusResponse>({
        type: 'serpent-connection-status',
      });
      connected = status.kind === 'connected';
    } catch {
      connected = false;
    }
    if (!connected) {
      if (!dragEndedEarly) {
        showBubble(clientX, clientY, '未连接 Serpent', '请先启动应用并打开资源库');
      }
      return;
    }

    let context: RadialMenuContext = { roots: [], quickPickFolders: [] };
    try {
      const response = await sendRuntimeMessage<FolderListResponse | FolderListErrorResponse>({
        type: 'serpent-list-folders',
      });
      if (response.kind === 'ok') {
        const tree = buildFolderTree(response.folders);
        const hints = buildSaveMenuFolderHints(
          response.folders,
          Array.isArray(response.recentFolderIds) ? response.recentFolderIds : [],
          Array.isArray(response.recentBrowsedFolderIds) ? response.recentBrowsedFolderIds : [],
        );
        const firstLevelIds = Array.isArray(response.firstLevelFolderIds)
          && response.firstLevelFolderIds.length > 0
          ? response.firstLevelFolderIds.slice(0, MAX_TOP_LEVEL_FOLDER_SLOTS)
          : splitSaveMenuFolders(response.folders, hints).topLevel.map((folder) => folder.folderId);
        const quickPickFolders = firstLevelIds
          .map((folderId) => tree.byId.get(folderId))
          .filter((node): node is FolderNode => node !== undefined);
        context = { roots: tree.roots, quickPickFolders };
      }
    } catch {
      // 文件夹列表失败时降级为仅根目录（与既有浮层策略一致）
    }

    if (dragEndedEarly) return;
    openWheel(clientX, clientY, media, context);
  } finally {
    document.removeEventListener('dragend', earlyEnd, { capture: true });
  }
}
