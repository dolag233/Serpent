// Content script for Serpent browser extension.
// Intercepts the contextmenu event on <img> and <video> elements,
// captures the media src and page URL, and sends the info to the
// background service worker.

document.addEventListener('contextmenu', (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  let kind: 'image' | 'video';
  let mediaUrl: string | null;

  if (target instanceof HTMLImageElement) {
    kind = 'image';
    mediaUrl = target.src;
  } else if (target instanceof HTMLVideoElement) {
    kind = 'video';
    // Try the video src first, then fall back to the first <source> child.
    mediaUrl = target.src || target.querySelector('source')?.src || null;
  } else {
    return;
  }

  // Reject data: URIs — they cannot be downloaded by the desktop app.
  if (!mediaUrl || mediaUrl.startsWith('data:')) {
    return;
  }

  chrome.runtime.sendMessage({
    type: 'capture-media',
    kind,
    sourcePageUrl: document.location.href,
    mediaUrl,
  }).catch(() => {
    // Fire-and-forget: silently ignore if the background service worker
    // is not ready or the extension context is invalid.
  });
});
