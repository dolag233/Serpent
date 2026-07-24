import { resolveMediaTargetAtPoint } from './media-target';
import { shouldUseOverlayMenu } from './overlay-hosts';
import { showOverlaySaveMenu } from './overlay-menu';

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
