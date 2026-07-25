import { resolveMediaTargetAtPoint } from './media-target';
import { shouldUseOverlayMenu } from './overlay-hosts';
import { showOverlaySaveMenu } from './overlay-menu';
import {
  DRAG_RADIAL_MENU_ENABLED_KEY,
  dragRadialMenuEnabledFromStored,
  readDragRadialMenuEnabled,
} from './preferences';
import { applyDragGhostThumbnail, startRadialSaveMenu } from './radial-menu';

document.addEventListener(
  'contextmenu',
  (event) => {
    const media = resolveMediaTargetAtPoint(document, event.clientX, event.clientY);
    if (!media) return;

    const target = event.target instanceof Element ? event.target : null;
    if (!shouldUseOverlayMenu(target, window.location.hostname)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    void showOverlaySaveMenu(event.clientX, event.clientY, media);
  },
  true,
);

// Serpent-6llg / REQ-EXT-005：拖拽图片/视频时展开径向保存轮盘（全站点生效）。
// 可在扩展设置中关闭；内容脚本侧缓存开关并监听变更，避免每次 dragstart 都读存储。
let radialMenuEnabled = true;
void readDragRadialMenuEnabled().then((enabled) => {
  radialMenuEnabled = enabled;
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;
  const change = changes[DRAG_RADIAL_MENU_ENABLED_KEY];
  if (change) {
    radialMenuEnabled = dragRadialMenuEnabledFromStored(change.newValue);
  }
});

// 不 preventDefault——原生拖拽照常进行，轮盘只是顺路的保存菜单。
document.addEventListener(
  'dragstart',
  (event) => {
    if (!radialMenuEnabled) return;
    const media = resolveMediaTargetAtPoint(document, event.clientX, event.clientY);
    if (!media) return;
    applyDragGhostThumbnail(event);
    void startRadialSaveMenu(event.clientX, event.clientY, media);
  },
  true,
);
