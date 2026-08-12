import { isFileUrl, mediaFromElement, resolveMediaTargetFromDragEvent } from './media-target';
import {
  DRAG_RADIAL_MENU_ENABLED_KEY,
  dragRadialMenuEnabledFromStored,
  readDragRadialMenuEnabled,
} from './preferences';
import {
  applyDragGhostThumbnail,
  encodeLocalImage,
  startRadialSaveMenu,
} from './radial-menu';
import { showSaveToast } from './save-bubble';

// 右键菜单保存（background.ts）通过此消息把「保存中/保存结果」反馈到当前页面。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;
  const type = Reflect.get(message, 'type');
  if (type === 'serpent-local-context-save-request') {
    void (async () => {
      const mediaUrl = Reflect.get(message, 'mediaUrl');
      const targetFolderId = Reflect.get(message, 'targetFolderId');
      const image = typeof mediaUrl === 'string'
        ? Array.from(document.images).find((candidate) => {
          const media = mediaFromElement(candidate);
          return media?.mediaUrl === mediaUrl && isFileUrl(media.mediaUrl);
        })
        : undefined;
      const localUpload = image && typeof mediaUrl === 'string'
        ? await encodeLocalImage(image, mediaUrl)
        : null;
      if (!localUpload) {
        showSaveToast('无法读取本地图片', '请在扩展详情中允许访问文件网址。');
        sendResponse({ ok: false });
        return;
      }
      chrome.runtime.sendMessage({
        type: 'serpent-local-save-request',
        ...localUpload,
        ...(targetFolderId === undefined ? {} : { targetFolderId }),
      }, (response) => {
        if (chrome.runtime.lastError) {
          showSaveToast('无法保存到 Serpent', '本地图片上传失败。');
        } else {
          const notification = response && typeof response === 'object'
            ? Reflect.get(response, 'notification')
            : undefined;
          const title = notification && typeof notification === 'object'
            ? Reflect.get(notification, 'title')
            : '无法保存到 Serpent';
          const message = notification && typeof notification === 'object'
            ? Reflect.get(notification, 'message')
            : '本地图片上传失败。';
          showSaveToast(
            title,
            message,
          );
        }
        sendResponse({ ok: true });
      });
    })();
    return true;
  }
  if (type !== 'serpent-save-feedback') return;
  if (Reflect.get(message, 'state') === 'saving') {
    showSaveToast('正在保存到 Serpent', '发送中…');
  } else {
    showSaveToast(Reflect.get(message, 'title'), Reflect.get(message, 'message'));
  }
  sendResponse({ ok: true });
});

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
    const media = resolveMediaTargetFromDragEvent(document, event);
    if (!media) return;
    applyDragGhostThumbnail(event, media.sourceElement);
    void startRadialSaveMenu(event.clientX, event.clientY, media);
  },
  true,
);
