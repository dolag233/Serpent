import {
  buildSaveMenuFolderHints,
  type ExtensionFolderOption,
} from './folder-menu';
import { findMediaElementAtPoint, type MediaTarget } from './media-target';
import {
  DEFAULT_TREE_GEOMETRY,
  TREE_NAV_DWELL_MS,
  TREE_SEPARATOR_HEIGHT,
  armedHint,
  buildFolderTree,
  clampCenter,
  clampScroll,
  crumbForLevel,
  edgeScrollDelta,
  hitTestTree,
  isFolderItem,
  itemsForLevel,
  measureTreePanel,
  parentInfoForLevel,
  pickTreeRecentFolderIds,
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
  libraryDisplayName?: string;
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
      if (response === undefined || response === null) {
        reject(new Error('runtime message returned empty response'));
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
    overflow: visible;
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
    border-radius: 14px;
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
  }
  .bridge-col {
    position: relative;
    flex: 0 0 ${GEOMETRY.bridgeGap}px;
    width: ${GEOMETRY.bridgeGap}px;
    align-self: stretch;
    pointer-events: none;
  }
  .bridge-col svg {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    overflow: visible;
  }
  .bridge-col path {
    fill: none;
    stroke: rgba(255, 255, 255, 0.16);
    stroke-width: 1;
    stroke-linecap: round;
  }
  .pill {
    display: flex; align-items: stretch;
    min-width: ${GEOMETRY.parentMinWidth}px;
    max-width: ${GEOMETRY.parentMinWidth}px;
    height: ${GEOMETRY.itemHeight}px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    overflow: hidden;
    box-sizing: border-box;
  }
  .pill.is-armed {
    background: rgba(59, 130, 246, 0.78);
    border-color: rgba(147, 197, 253, 0.55);
  }
  .pill.is-dwell .back {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
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
  .cmd .drill.is-dwell {
    background: rgba(255, 255, 255, 0.22);
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
    max-width: ${GEOMETRY.listWidth}px;
    overflow: hidden;
    border-radius: 8px;
  }
  .list-col .fade-top,
  .list-col .fade-bottom {
    position: absolute; left: 0; right: 0; z-index: 2;
    height: 18px; pointer-events: none;
    opacity: 0;
    transition: opacity 180ms ease;
  }
  .list-col .fade-top {
    top: 0;
    background: linear-gradient(to bottom, rgba(42,44,48,0.9), transparent);
  }
  .list-col .fade-bottom {
    bottom: 0;
    background: linear-gradient(to top, rgba(42,44,48,0.9), transparent);
  }
  .list-col .fade-top.is-visible,
  .list-col .fade-bottom.is-visible {
    opacity: 1;
  }
  .list-scroll {
    position: absolute; left: 0; right: 0; top: 0;
    will-change: transform;
    padding-right: 2px;
    box-sizing: border-box;
  }
  .cmd {
    display: flex; align-items: stretch;
    height: ${GEOMETRY.itemHeight}px;
    margin-bottom: ${GEOMETRY.itemGap}px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.1);
    overflow: hidden;
    box-sizing: border-box;
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
  .cmd .clock {
    width: 12px; height: 12px; flex: 0 0 12px;
    color: rgba(147, 197, 253, 0.9);
    opacity: 0.92;
  }
  .cmd .clock svg { width: 12px; height: 12px; display: block; }
  .cmd.is-armed .clock { color: rgba(255, 255, 255, 0.95); }
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
  .separator {
    display: flex; align-items: center;
    height: 14px;
    margin: 0;
    pointer-events: none;
  }
  .separator::before {
    content: "";
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.12);
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
    bottom: calc(100% + 10px);
    color: rgba(245, 245, 245, 0.92); font-size: 12px; white-space: nowrap;
    background: rgba(48, 50, 54, 0.82); padding: 3px 12px; border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }
  .cancel-chip {
    position: absolute; left: 50%; transform: translateX(-50%);
    top: calc(100% + 12px);
    font-size: 11px; color: rgba(245,245,245,0.72);
    background: rgba(30, 32, 36, 0.72);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 999px; padding: 4px 10px;
    white-space: nowrap;
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
  clock: svgIcon('<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l2.5 1.5"/>'),
};

function iconForItem(item: TreeItem): string {
  if (!isFolderItem(item)) return ICONS.folder;
  if (item.folderId === null && item.path === ROOT_FOLDER_PATH) return ICONS.home;
  return ICONS.folder;
}

interface MenuState {
  stack: TreeLevel[];
  origin: { x: number; y: number };
  scrollY: number;
  hit: TreeHit;
  /** 当前停留导航键（back / drill:index）；满 TREE_NAV_DWELL_MS 才跳转 */
  navDwellKey: string | null;
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
let navDwellTimer = 0;

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

function currentParent(): TreeParentInfo {
  if (!state) {
    return {
      label: 'Serpent',
      path: ROOT_FOLDER_PATH,
      folderId: null,
      backTarget: { kind: 'root' },
      showBack: false,
    };
  }
  return parentInfoForLevel(currentLevel(), state.context);
}

function recomputeLayout(): TreePanelLayout | null {
  if (!state) return null;
  const items = currentItems();
  const parent = currentParent();
  const layout = measureTreePanel(
    state.origin.x,
    state.origin.y,
    items,
    parent,
    window.innerWidth,
    window.innerHeight,
    GEOMETRY,
  );
  state.layout = layout;
  state.scrollY = clampScroll(state.scrollY, layout.maxScroll);
  return layout;
}

function clearNavDwell(): void {
  if (navDwellTimer) {
    window.clearTimeout(navDwellTimer);
    navDwellTimer = 0;
  }
  if (state) state.navDwellKey = null;
}

function scheduleNavDwell(key: string, action: () => void): void {
  if (!state || state.animating) return;
  if (state.navDwellKey === key) return;
  clearNavDwell();
  state.navDwellKey = key;
  navDwellTimer = window.setTimeout(() => {
    navDwellTimer = 0;
    if (!state || state.navDwellKey !== key) return;
    state.navDwellKey = null;
    action();
  }, TREE_NAV_DWELL_MS);
}

function buildBridgeSvg(
  items: readonly TreeItem[],
  listHeight: number,
  scrollY: number,
): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const g = GEOMETRY.bridgeGap;
  const parentCy = listHeight / 2;
  let offset = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const height =
      item.kind === 'separator' ? TREE_SEPARATOR_HEIGHT : GEOMETRY.itemHeight;
    if (item.kind === 'folder') {
      const itemCy = offset + height / 2 - scrollY;
      if (itemCy >= -8 && itemCy <= listHeight + 8) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const c1x = g * 0.55;
        const c2x = g * 0.45;
        path.setAttribute(
          'd',
          `M 0 ${parentCy.toFixed(1)} C ${c1x.toFixed(1)} ${parentCy.toFixed(1)} ${c2x.toFixed(1)} ${itemCy.toFixed(1)} ${g.toFixed(1)} ${itemCy.toFixed(1)}`,
        );
        svg.appendChild(path);
      }
    }
    offset += height + GEOMETRY.itemGap;
  }
  return svg;
}

function refreshBridges(
  slide: HTMLElement,
  items: readonly TreeItem[],
  listHeight: number,
  scrollY: number,
): void {
  const bridgeCol = slide.querySelector<HTMLDivElement>('.bridge-col');
  if (!bridgeCol) return;
  bridgeCol.replaceChildren(buildBridgeSvg(items, listHeight, scrollY));
}

function syncListEdgeFades(
  listCol: HTMLElement,
  scrollY: number,
  maxScroll: number,
): void {
  const top = listCol.querySelector('.fade-top');
  const bottom = listCol.querySelector('.fade-bottom');
  // 到顶不显示上黑幕；到底不显示下黑幕；用 class + CSS transition 渐隐
  top?.classList.toggle('is-visible', scrollY > 0.5);
  bottom?.classList.toggle(
    'is-visible',
    maxScroll > 0.5 && scrollY < maxScroll - 0.5,
  );
}

function buildSlideDom(
  items: readonly TreeItem[],
  parent: TreeParentInfo,
  hit: TreeHit,
  listHeight: number,
  scrollY: number,
  maxScroll: number,
  dwellKey: string | null,
): HTMLDivElement {
  const slide = document.createElement('div');
  slide.className = 'slide is-center';

  const col = document.createElement('div');
  col.className = 'parent-col';
  const pill = document.createElement('div');
  const dwellBack = dwellKey === 'back';
  pill.className = `pill${hit.zone === 'parent' || hit.zone === 'back' ? ' is-armed' : ''}${
    dwellBack ? ' is-dwell' : ''
  }`;
  if (parent.showBack) {
    const back = document.createElement('div');
    back.className = `back${hit.zone === 'back' ? ' is-hot' : ''}`;
    back.textContent = '‹';
    pill.appendChild(back);
  }
  const body = document.createElement('div');
  body.className = 'body';
  const ico = document.createElement('span');
  ico.className = 'ico';
  ico.innerHTML =
    parent.folderId === null && parent.path === ROOT_FOLDER_PATH
      ? ICONS.home
      : ICONS.folder;
  const txt = document.createElement('span');
  txt.className = 'txt';
  txt.textContent = parent.label;
  body.append(ico, txt);
  pill.appendChild(body);
  col.appendChild(pill);
  slide.appendChild(col);

  const bridgeCol = document.createElement('div');
  bridgeCol.className = 'bridge-col';
  bridgeCol.appendChild(buildBridgeSvg(items, listHeight, scrollY));
  slide.appendChild(bridgeCol);

  const listCol = document.createElement('div');
  listCol.className = 'list-col';
  listCol.style.height = `${listHeight}px`;
  const fadeTop = document.createElement('div');
  fadeTop.className = 'fade-top';
  fadeTop.setAttribute('aria-hidden', 'true');
  const fadeBottom = document.createElement('div');
  fadeBottom.className = 'fade-bottom';
  fadeBottom.setAttribute('aria-hidden', 'true');
  const scroll = document.createElement('div');
  scroll.className = 'list-scroll';
  scroll.style.transform = `translateY(${-scrollY}px)`;

  items.forEach((item, index) => {
    if (item.kind === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'separator';
      sep.setAttribute('role', 'separator');
      scroll.appendChild(sep);
      return;
    }
    const cmd = document.createElement('div');
    const armed =
      (hit.zone === 'item' || hit.zone === 'drill') && hit.index === index;
    const drillKey = `drill:${index}`;
    const isRecent = item.section === 'recent';
    cmd.className = `cmd${armed ? ' is-armed' : ''}${isRecent ? ' is-recent' : ''}`;
    const cmdBody = document.createElement('div');
    cmdBody.className = 'body';
    const cmdIco = document.createElement('span');
    cmdIco.className = 'ico';
    cmdIco.innerHTML = iconForItem(item);
    const cmdTxt = document.createElement('span');
    cmdTxt.className = 'txt';
    cmdTxt.textContent = item.label;
    cmdBody.append(cmdIco, cmdTxt);
    if (isRecent) {
      const clock = document.createElement('span');
      clock.className = 'clock';
      clock.setAttribute('aria-hidden', 'true');
      clock.innerHTML = ICONS.clock;
      cmdBody.appendChild(clock);
    }
    cmd.appendChild(cmdBody);
    const drill = document.createElement('div');
    drill.className = `drill${item.expandable ? '' : ' is-disabled'}${
      hit.zone === 'drill' && hit.index === index ? ' is-hot' : ''
    }${dwellKey === drillKey ? ' is-dwell' : ''}`;
    drill.textContent = '›';
    cmd.appendChild(drill);
    scroll.appendChild(cmd);
  });

  listCol.append(scroll, fadeTop, fadeBottom);
  syncListEdgeFades(listCol, scrollY, maxScroll);
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
    buildSlideDom(
      items,
      parent,
      s.hit,
      layout.listViewport.h,
      s.scrollY,
      layout.maxScroll,
      s.navDwellKey,
    ),
  );

  const hintText =
    armedHint(s.hit, items, parent) ??
    crumbForLevel(currentLevel(), s.context.libraryDisplayName);
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

  const incoming = buildSlideDom(
    items,
    parent,
    s.hit,
    layout.listViewport.h,
    s.scrollY,
    layout.maxScroll,
    s.navDwellKey,
  );
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

  hint.textContent =
    armedHint(s.hit, items, parent) ??
    crumbForLevel(currentLevel(), s.context.libraryDisplayName);
}

function pushLevel(target: TreeLevel): void {
  if (!state || state.animating) return;
  clearNavDwell();
  state.stack.push(target);
  state.scrollY = 0;
  state.hit = { zone: 'none', index: -1 };
  runSlideTransition('forward');
}

function goBack(): void {
  if (!state || state.animating) return;
  if (state.stack.length <= 1) return;
  clearNavDwell();
  state.stack.pop();
  state.scrollY = 0;
  state.hit = { zone: 'none', index: -1 };
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

  const delta = edgeScrollDelta(clientX, clientY, layout, GEOMETRY);
  if (delta !== 0 && layout.maxScroll > 0) {
    s.scrollY = clampScroll(s.scrollY + delta, layout.maxScroll);
  }

  const items = currentItems();
  const hit = hitTestTree(
    clientX,
    clientY,
    layout,
    items,
    s.scrollY,
    GEOMETRY,
  );
  s.hit = hit;

  const parent = currentParent();
  if (hit.zone === 'back' && parent.showBack) {
    scheduleNavDwell('back', () => goBack());
  } else if (hit.zone === 'drill' && hit.index >= 0) {
    const item = items[hit.index];
    if (item && isFolderItem(item) && item.expandable && item.target) {
      const key = `drill:${hit.index}`;
      const target = item.target;
      scheduleNavDwell(key, () => pushLevel(target));
    } else {
      clearNavDwell();
    }
  } else if (s.navDwellKey) {
    clearNavDwell();
  }

  // 轻量更新：只刷 class / scroll / 连线，避免整树重建过频
  const slide = hostEl?.querySelector<HTMLDivElement>('.slide.is-center');
  if (!slide) {
    renderStatic();
    return;
  }
  const scroll = slide.querySelector<HTMLDivElement>('.list-scroll');
  if (scroll) scroll.style.transform = `translateY(${-s.scrollY}px)`;
  const listCol = slide.querySelector<HTMLDivElement>('.list-col');
  if (listCol) syncListEdgeFades(listCol, s.scrollY, layout.maxScroll);
  refreshBridges(slide, items, layout.listViewport.h, s.scrollY);

  const pill = slide.querySelector<HTMLDivElement>('.pill');
  if (pill) {
    pill.classList.toggle('is-armed', hit.zone === 'parent' || hit.zone === 'back');
    pill.classList.toggle('is-dwell', s.navDwellKey === 'back');
    const back = pill.querySelector('.back');
    back?.classList.toggle('is-hot', hit.zone === 'back');
  }
  const cmds = slide.querySelectorAll<HTMLDivElement>('.cmd');
  let cmdIndex = 0;
  items.forEach((item, index) => {
    if (!isFolderItem(item)) return;
    const cmd = cmds[cmdIndex++];
    if (!cmd) return;
    const armed = (hit.zone === 'item' || hit.zone === 'drill') && hit.index === index;
    cmd.classList.toggle('is-armed', armed);
    const drill = cmd.querySelector('.drill');
    const drillKey = `drill:${index}`;
    drill?.classList.toggle('is-hot', hit.zone === 'drill' && hit.index === index);
    drill?.classList.toggle('is-dwell', s.navDwellKey === drillKey);
  });

  const hint = hostEl?.querySelector<HTMLDivElement>('.hint');
  if (hint) {
    hint.textContent =
      armedHint(hit, items, parent) ??
      crumbForLevel(currentLevel(), s.context.libraryDisplayName);
  }
}

function pumpEdgeScroll(): void {
  if (scrollRaf) return;
  const tick = (): void => {
    scrollRaf = 0;
    if (!state || !state.layout) return;
    const { x, y } = state.pointer;
    const delta = edgeScrollDelta(x, y, state.layout, GEOMETRY);
    if (delta === 0 || state.layout.maxScroll <= 0) return;
    updateHitFromPointer(x, y);
    scrollRaf = window.requestAnimationFrame(tick);
  };
  scrollRaf = window.requestAnimationFrame(tick);
}

function onDragOver(event: DragEvent): void {
  if (!state) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  updateHitFromPointer(event.clientX, event.clientY);
  pumpEdgeScroll();
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
    if (item && isFolderItem(item)) {
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
    const label =
      parent.folderId === null
        ? `${parent.label}（根目录）`
        : parent.path.split('/').join(' / ');
    showBubble(event.clientX, event.clientY, `保存到：${label}`, '发送中…');
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
  clearNavDwell();
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
    navDwellKey: null,
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

    let context: TreeMenuContext = {
      roots: [],
      recentFolders: [],
      libraryDisplayName: 'Serpent',
    };
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
        const recentIds = pickTreeRecentFolderIds(
          hints.savedRecentIds,
          hints.browsedRecentIds,
        );
        const recentFolders = recentIds
          .map((folderId) => tree.byId.get(folderId))
          .filter((node): node is FolderNode => node !== undefined);
        context = {
          roots: tree.roots,
          recentFolders,
          libraryDisplayName:
            typeof response.libraryDisplayName === 'string' &&
            response.libraryDisplayName.trim()
              ? response.libraryDisplayName.trim()
              : 'Serpent',
        };
      }
    } catch {
      // 文件夹列表失败时降级为仅库名父节点
    }

    if (dragEndedEarly) return;
    openMenu(clientX, clientY, media, context);
  } finally {
    document.removeEventListener('dragend', earlyEnd, { capture: true });
  }
}
