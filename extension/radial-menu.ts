import {
  buildSaveMenuFolderHints,
  splitSaveMenuFolders,
  type ExtensionFolderOption,
} from './folder-menu';
import { findMediaElementAtPoint, type MediaTarget } from './media-target';
import {
  DEFAULT_TREE_GEOMETRY,
  armedHint,
  buildFolderTree,
  clampCenter,
  clampScroll,
  crumbForLevel,
  edgeScrollDelta,
  hitTestTree,
  itemsForLevel,
  measureTreePanel,
  parentInfoForLevel,
  type FolderNode,
  type TreeHit,
  type TreeItem,
  type TreeLevel,
  type TreeMenuContext,
  type TreePanelLayout,
  type TreeParentInfo,
} from './radial-menu-model';
import type { SaveIntent } from './save-client';

/**
 * Serpent-c0ml / REQ-EXT-005 思维导图树状拖放保存菜单。
 * 规格：docs/ui/0002-extension-drag-radial-save-menu.md（v7）。
 * 命中走矩形几何（radial-menu-model）；面板 pointer-events:none，不拦截原生拖拽。
 */

const GEOMETRY = DEFAULT_TREE_GEOMETRY;
const ROOT_FOLDER_PATH = '根目录';
const SLIDE_MS = 240;

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

const STYLE_TEXT = `
  :host { all: initial; }
  .scrim {
    position: fixed; inset: 0; pointer-events: none;
    background: rgba(0, 0, 0, 0.42); opacity: 0;
    transition: opacity 150ms ease-out;
  }
  .scrim.show { opacity: 1; }
  .tree-host {
    position: fixed; left: 0; top: 0; z-index: 2147483647;
    pointer-events: none;
    font: 13px/1.35 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    color: #f3f4f6;
  }
  .panel {
    position: absolute; left: 0; top: 0;
    border-radius: 14px;
    background: rgba(42, 44, 48, 0.78);
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.34);
    overflow: hidden;
    animation: serpent-tree-in 140ms ease-out;
  }
  @keyframes serpent-tree-in {
    from { transform: scale(0.94); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
  .stage {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .slide {
    position: absolute; inset: 0;
    display: flex;
    align-items: stretch;
    padding: ${GEOMETRY.panelPad}px;
    box-sizing: border-box;
    will-change: transform, opacity;
    transition: transform ${SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
                opacity ${SLIDE_MS}ms ease;
  }
  .slide.is-enter-from-right { transform: translateX(28%); opacity: 0; }
  .slide.is-enter-from-left { transform: translateX(-28%); opacity: 0; }
  .slide.is-center { transform: translateX(0); opacity: 1; }
  .slide.is-exit-to-left { transform: translateX(-28%); opacity: 0; }
  .slide.is-exit-to-right { transform: translateX(28%); opacity: 0; }
  .parent-col {
    display: flex; align-items: center; flex: 0 0 auto;
    margin-right: ${GEOMETRY.bridgeGap}px;
  }
  .pill {
    display: flex; align-items: stretch;
    min-width: ${GEOMETRY.parentMinWidth}px;
    height: ${GEOMETRY.itemHeight}px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .pill.is-armed {
    background: rgba(59, 130, 246, 0.78);
    border-color: rgba(147, 197, 253, 0.55);
  }
  .pill .back, .pill .body, .cmd .body, .cmd .drill {
    display: flex; align-items: center; justify-content: center;
  }
  .pill .back {
    width: ${GEOMETRY.backWidth}px;
    flex: 0 0 ${GEOMETRY.backWidth}px;
    border-right: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.78);
    font-size: 14px;
  }
  .pill .back.is-hot, .cmd .drill.is-hot {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }
  .pill .body {
    flex: 1; padding: 0 10px;
    justify-content: flex-start; gap: 6px;
    min-width: 0;
  }
  .list-col {
    position: relative;
    flex: 1 1 auto;
    width: ${GEOMETRY.listWidth}px;
    min-width: ${GEOMETRY.listWidth}px;
    overflow: hidden;
  }
  .list-scroll {
    position: absolute; left: 0; right: 0; top: 0;
    will-change: transform;
  }
  .cmd {
    display: flex; align-items: stretch;
    height: ${GEOMETRY.itemHeight}px;
    margin-bottom: ${GEOMETRY.itemGap}px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }
  .cmd:last-child { margin-bottom: 0; }
  .cmd.is-armed {
    background: rgba(59, 130, 246, 0.78);
    border-color: rgba(147, 197, 253, 0.55);
  }
  .cmd .body {
    flex: 1; padding: 0 10px;
    justify-content: flex-start; gap: 7px;
    min-width: 0;
  }
  .cmd .drill {
    width: ${GEOMETRY.drillWidth}px;
    flex: 0 0 ${GEOMETRY.drillWidth}px;
    border-left: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
  }
  .cmd .drill.is-disabled {
    opacity: 0.28;
  }
  .ico {
    width: 16px; height: 16px; flex: 0 0 16px; color: rgba(245,245,245,0.92);
  }
  .ico svg { width: 16px; height: 16px; display: block; }
  .txt {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 12.5px; font-weight: 500;
  }
  .cmd.is-armed .txt, .pill.is-armed .txt { font-weight: 700; }
  .hint {
    position: absolute; left: 50%; transform: translateX(-50%);
    bottom: calc(100% + 8px);
    color: rgba(245, 245, 245, 0.92); font-size: 12px; white-space: nowrap;
    background: rgba(48, 50, 54, 0.82); padding: 3px 12px; border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }
  .cancel-chip {
    position: absolute; left: 50%; transform: translateX(-50%);
    top: calc(100% + 10px);
    font-size: 11px; color: rgba(245,245,245,0.72);
    background: rgba(30, 32, 36, 0.72);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 999px; padding: 4px 10px;
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

function svgIcon(inner: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const ICONS = {
  folder: svgIcon('<path d="M4 8a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>'),
  home: svgIcon('<path d="M4.5 11 12 4.5 19.5 11"/><path d="M6.5 9.5V19h11V9.5"/>'),
};

function iconForItem(item: TreeItem): string {
  if (item.folderId === null && item.path === ROOT_FOLDER_PATH) return ICONS.home;
  return ICONS.folder;
}

interface MenuState {
  stack: TreeLevel[];
  origin: { x: number; y: number };
  scrollY: number;
  hit: TreeHit;
  /** 导航热区守卫：进入/返回后须先离开 drill/back 再允许下次触发 */
  navArmed: boolean;
  animating: boolean;
  pointer: { x: number; y: number };
  media: MediaTarget;
  context: TreeMenuContext;
  layout: TreePanelLayout | null;
}

let shadowRoot: ShadowRoot | null = null;
let scrimEl: HTMLDivElement | null = null;
let hostEl: HTMLDivElement | null = null;
let state: MenuState | null = null;
let bubbleTimer = 0;
let scrollRaf = 0;

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
  scrimEl = document.createElement('div');
  scrimEl.className = 'scrim';
  root.appendChild(scrimEl);
  document.documentElement.appendChild(host);
  shadowRoot = root;
  return root;
}

function currentLevel(): TreeLevel {
  const stack = state?.stack;
  const level = stack?.[(stack.length ?? 1) - 1];
  if (!level) throw new Error('tree menu: empty stack');
  return level;
}

function currentItems(): TreeItem[] {
  if (!state) return [];
  return itemsForLevel(currentLevel(), state.context);
}

function currentParent(): TreeParentInfo | null {
  if (!state) return null;
  return parentInfoForLevel(currentLevel(), state.context);
}

function recomputeLayout(): TreePanelLayout | null {
  if (!state) return null;
  const items = currentItems();
  const parent = currentParent();
  const layout = measureTreePanel(
    state.origin.x,
    state.origin.y,
    items.length,
    parent !== null,
    window.innerWidth,
    window.innerHeight,
    GEOMETRY,
  );
  state.layout = layout;
  state.scrollY = clampScroll(state.scrollY, layout.maxScroll);
  return layout;
}

function buildSlideDom(
  items: readonly TreeItem[],
  parent: TreeParentInfo | null,
  hit: TreeHit,
  listHeight: number,
  scrollY: number,
): HTMLDivElement {
  const slide = document.createElement('div');
  slide.className = 'slide is-center';

  if (parent) {
    const col = document.createElement('div');
    col.className = 'parent-col';
    const pill = document.createElement('div');
    pill.className = `pill${hit.zone === 'parent' || hit.zone === 'back' ? ' is-armed' : ''}`;
    const back = document.createElement('div');
    back.className = `back${hit.zone === 'back' ? ' is-hot' : ''}`;
    back.textContent = '‹';
    const body = document.createElement('div');
    body.className = 'body';
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.innerHTML = parent.path === ROOT_FOLDER_PATH ? ICONS.home : ICONS.folder;
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = parent.label;
    body.append(ico, txt);
    pill.append(back, body);
    col.appendChild(pill);
    slide.appendChild(col);
  }

  const listCol = document.createElement('div');
  listCol.className = 'list-col';
  listCol.style.height = `${listHeight}px`;
  const scroll = document.createElement('div');
  scroll.className = 'list-scroll';
  scroll.style.transform = `translateY(${-scrollY}px)`;

  items.forEach((item, index) => {
    const cmd = document.createElement('div');
    const armed =
      (hit.zone === 'item' || hit.zone === 'drill') && hit.index === index;
    cmd.className = `cmd${armed ? ' is-armed' : ''}`;
    const body = document.createElement('div');
    body.className = 'body';
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.innerHTML = iconForItem(item);
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = item.label;
    body.append(ico, txt);
    cmd.appendChild(body);
    const drill = document.createElement('div');
    drill.className = `drill${item.expandable ? '' : ' is-disabled'}${
      hit.zone === 'drill' && hit.index === index ? ' is-hot' : ''
    }`;
    drill.textContent = '›';
    cmd.appendChild(drill);
    scroll.appendChild(cmd);
  });

  listCol.appendChild(scroll);
  slide.appendChild(listCol);
  return slide;
}

function renderStatic(): void {
  const s = state;
  if (!s || !hostEl) return;
  const layout = recomputeLayout();
  if (!layout) return;
  const items = currentItems();
  const parent = currentParent();
  const panel = hostEl.querySelector<HTMLDivElement>('.panel');
  const stage = hostEl.querySelector<HTMLDivElement>('.stage');
  const hint = hostEl.querySelector<HTMLDivElement>('.hint');
  if (!panel || !stage || !hint) return;

  panel.style.width = `${layout.panel.w}px`;
  panel.style.height = `${layout.panel.h}px`;
  hostEl.style.left = `${layout.panel.x}px`;
  hostEl.style.top = `${layout.panel.y}px`;
  hostEl.style.width = `${layout.panel.w}px`;
  hostEl.style.height = `${layout.panel.h}px`;

  stage.replaceChildren(
    buildSlideDom(items, parent, s.hit, layout.listViewport.h, s.scrollY),
  );

  const hintText = armedHint(s.hit, items, parent) ?? crumbForLevel(currentLevel());
  hint.textContent = hintText;
}

function runSlideTransition(direction: 'forward' | 'back'): void {
  const s = state;
  if (!s || !hostEl) return;
  const layout = recomputeLayout();
  if (!layout) return;
  const stage = hostEl.querySelector<HTMLDivElement>('.stage');
  const panel = hostEl.querySelector<HTMLDivElement>('.panel');
  const hint = hostEl.querySelector<HTMLDivElement>('.hint');
  if (!stage || !panel || !hint) return;

  const outgoing = stage.querySelector<HTMLDivElement>('.slide');
  const items = currentItems();
  const parent = currentParent();
  panel.style.width = `${layout.panel.w}px`;
  panel.style.height = `${layout.panel.h}px`;
  hostEl.style.left = `${layout.panel.x}px`;
  hostEl.style.top = `${layout.panel.y}px`;
  hostEl.style.width = `${layout.panel.w}px`;
  hostEl.style.height = `${layout.panel.h}px`;

  const incoming = buildSlideDom(items, parent, s.hit, layout.listViewport.h, s.scrollY);
  incoming.className =
    direction === 'forward'
      ? 'slide is-enter-from-right'
      : 'slide is-enter-from-left';
  stage.appendChild(incoming);

  s.animating = true;
  // Force layout before flipping classes so the transition runs.
  void incoming.offsetWidth;
  if (outgoing) {
    outgoing.className =
      direction === 'forward' ? 'slide is-exit-to-left' : 'slide is-exit-to-right';
  }
  incoming.className = 'slide is-center';

  window.setTimeout(() => {
    outgoing?.remove();
    if (state) state.animating = false;
    renderStatic();
  }, SLIDE_MS + 20);

  hint.textContent = armedHint(s.hit, items, parent) ?? crumbForLevel(currentLevel());
}

function pushLevel(target: TreeLevel): void {
  if (!state || state.animating) return;
  state.stack.push(target);
  state.scrollY = 0;
  state.hit = { zone: 'none', index: -1 };
  state.navArmed = false;
  runSlideTransition('forward');
}

function goBack(): void {
  if (!state || state.animating) return;
  if (state.stack.length <= 1) return;
  state.stack.pop();
  state.scrollY = 0;
  state.hit = { zone: 'none', index: -1 };
  state.navArmed = false;
  runSlideTransition('back');
}

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

function updateHitFromPointer(clientX: number, clientY: number): void {
  const s = state;
  if (!s || s.animating) return;
  s.pointer = { x: clientX, y: clientY };
  const layout = s.layout ?? recomputeLayout();
  if (!layout) return;

  const delta = edgeScrollDelta(clientY, layout, GEOMETRY);
  if (delta !== 0 && layout.maxScroll > 0) {
    s.scrollY = clampScroll(s.scrollY + delta, layout.maxScroll);
  }

  const items = currentItems();
  const hit = hitTestTree(
    clientX,
    clientY,
    layout,
    items.length,
    s.scrollY,
    GEOMETRY,
  );
  s.hit = hit;

  // 离开导航热区后重新武装导航
  if (hit.zone !== 'drill' && hit.zone !== 'back') {
    s.navArmed = true;
  }

  if (s.navArmed && hit.zone === 'back') {
    goBack();
    return;
  }
  if (s.navArmed && hit.zone === 'drill' && hit.index >= 0) {
    const item = items[hit.index];
    if (item?.expandable && item.target) {
      pushLevel(item.target);
      return;
    }
  }

  // 轻量更新：只刷 class / scroll，避免整树重建过频
  const slide = hostEl?.querySelector<HTMLDivElement>('.slide.is-center');
  if (!slide) {
    renderStatic();
    return;
  }
  const scroll = slide.querySelector<HTMLDivElement>('.list-scroll');
  if (scroll) scroll.style.transform = `translateY(${-s.scrollY}px)`;

  const parent = currentParent();
  const pill = slide.querySelector<HTMLDivElement>('.pill');
  if (pill) {
    pill.classList.toggle('is-armed', hit.zone === 'parent' || hit.zone === 'back');
    const back = pill.querySelector('.back');
    back?.classList.toggle('is-hot', hit.zone === 'back');
  }
  const cmds = slide.querySelectorAll<HTMLDivElement>('.cmd');
  cmds.forEach((cmd, index) => {
    const armed = (hit.zone === 'item' || hit.zone === 'drill') && hit.index === index;
    cmd.classList.toggle('is-armed', armed);
    const drill = cmd.querySelector('.drill');
    drill?.classList.toggle('is-hot', hit.zone === 'drill' && hit.index === index);
  });

  const hint = hostEl?.querySelector<HTMLDivElement>('.hint');
  if (hint) {
    hint.textContent = armedHint(hit, items, parent) ?? crumbForLevel(currentLevel());
  }
}

function onDragOver(event: DragEvent): void {
  if (!state) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  updateHitFromPointer(event.clientX, event.clientY);
  if (!scrollRaf && state) {
    scrollRaf = window.requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!state) return;
      const { x, y } = state.pointer;
      const layout = state.layout;
      if (!layout) return;
      const delta = edgeScrollDelta(y, layout, GEOMETRY);
      if (delta === 0) return;
      updateHitFromPointer(x, y);
    });
  }
}

function onDrop(event: DragEvent): void {
  const s = state;
  if (!s) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  updateHitFromPointer(event.clientX, event.clientY);
  const hit = s.hit;
  const items = currentItems();
  const parent = currentParent();

  if (hit.zone === 'item' && hit.index >= 0) {
    const item = items[hit.index];
    if (item) {
      const media = s.media;
      closeMenu();
      showBubble(
        event.clientX,
        event.clientY,
        `保存到：${item.path.split('/').join(' / ')}`,
        '发送中…',
      );
      void requestSave(media, item.folderId, event.clientX, event.clientY);
      return;
    }
  }
  if (hit.zone === 'parent' && parent) {
    const media = s.media;
    closeMenu();
    showBubble(
      event.clientX,
      event.clientY,
      `保存到：${parent.path.split('/').join(' / ')}`,
      '发送中…',
    );
    void requestSave(media, parent.folderId, event.clientX, event.clientY);
    return;
  }
  // drill/back 上松开不保存；非可展开 › 区松开视为取消
  if (hit.zone === 'drill' || hit.zone === 'back') {
    closeMenu();
    return;
  }
  closeMenu();
}

function onDragEnd(): void {
  closeMenu();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && state) closeMenu();
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

function closeMenu(): void {
  if (!state) return;
  state = null;
  detachDragListeners();
  if (scrollRaf) {
    window.cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
  }
  scrimEl?.classList.remove('show');
  hostEl?.remove();
  hostEl = null;
}

function openMenu(
  clientX: number,
  clientY: number,
  media: MediaTarget,
  context: TreeMenuContext,
): void {
  const root = ensureShadowRoot();
  hostEl?.remove();
  hostEl = document.createElement('div');
  hostEl.className = 'tree-host';
  hostEl.innerHTML =
    '<div class="panel"><div class="hint"></div><div class="stage"></div></div>' +
    '<div class="cancel-chip">移出菜单松开 · Esc 取消</div>';
  root.appendChild(hostEl);
  scrimEl?.classList.add('show');

  const origin = clampCenter(clientX, clientY, window.innerWidth, window.innerHeight);
  state = {
    stack: [{ kind: 'root' }],
    origin,
    scrollY: 0,
    hit: { zone: 'none', index: -1 },
    navArmed: true,
    animating: false,
    pointer: { x: clientX, y: clientY },
    media,
    context,
    layout: null,
  };
  attachDragListeners();
  renderStatic();
}

/* ================= 入口 ================= */

const DRAG_GHOST_MAX_SIZE = 96;

/**
 * 自定义拖拽幽灵：把指针下的媒体元素画进 ≤96px 画布缩略图，锚点固定在光标
 * 左上角。必须在 dragstart 内同步调用。
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
    return;
  }

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
    canvas.remove();
  }
}

/**
 * dragstart 时调用：校验连接、取文件夹树，再展开树状菜单。
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

    let context: TreeMenuContext = { roots: [], quickPickFolders: [] };
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
        // 树状菜单根级不限 8 槽：优先 firstLevel；否则用排序后的顶栏候选（可超过旧轮盘上限）。
        const firstLevelIds = Array.isArray(response.firstLevelFolderIds)
          && response.firstLevelFolderIds.length > 0
          ? response.firstLevelFolderIds
          : splitSaveMenuFolders(response.folders, hints).topLevel.map((folder) => folder.folderId);
        const quickPickFolders = firstLevelIds
          .map((folderId) => tree.byId.get(folderId))
          .filter((node): node is FolderNode => node !== undefined);
        context = { roots: tree.roots, quickPickFolders };
      }
    } catch {
      // 文件夹列表失败时降级为仅根目录
    }

    if (dragEndedEarly) return;
    openMenu(clientX, clientY, media, context);
  } finally {
    document.removeEventListener('dragend', earlyEnd, { capture: true });
  }
}
