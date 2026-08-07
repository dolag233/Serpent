import { resolveMediaTargetAtPoint } from './media-target';
import {
  DRAG_RADIAL_MENU_ENABLED_KEY,
  dragRadialMenuEnabledFromStored,
  readDragRadialMenuEnabled,
} from './preferences';
import { applyDragGhostThumbnail, startRadialSaveMenu } from './radial-menu';

// 右键保存走 Chrome 扩展原生 contextMenus（background.ts），不拦截页面右键，
// 避免浮层菜单替换整站原生菜单（Serpent-ak94 / 用户反馈 2026-07-26）。

// Serpent-c0ml / REQ-EXT-005：拖拽图片/视频时展开树状保存菜单（全站点生效）。
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
    const media = resolveMediaTargetAtPoint(
      document,
      event.clientX,
      event.clientY,
      event.composedPath(),
    );
    if (!media) return;
    applyDragGhostThumbnail(event);
    void startRadialSaveMenu(event.clientX, event.clientY, media);
  },
  true,
);
