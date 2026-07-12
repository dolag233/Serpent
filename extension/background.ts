// MV3 Service Worker for Serpent browser extension.
// Creates a context menu item "Save to Serpent", receives media capture
// messages from the content script, and POSTs save intents to the
// Serpent desktop app via localhost HTTP (fire-and-forget).

const SERPENT_PORTS = [19876, 19877, 19878];
const SERPENT_HOST = 'http://127.0.0.1';

interface SaveIntent {
  kind: 'image' | 'video';
  sourcePageUrl: string;
  mediaUrl: string;
  mediaType?: string;
}

// Per-tab storage for the last captured media element info.
// Keyed by tab ID; cleared after the context menu click is processed.
const capturedMedia = new Map<number, SaveIntent>();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-serpent',
    title: 'Save to Serpent',
    contexts: ['image', 'video'],
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'capture-media' &&
    sender.tab?.id !== undefined
  ) {
    capturedMedia.set(sender.tab.id, {
      kind: message.kind as 'image' | 'video',
      sourcePageUrl: message.sourcePageUrl as string,
      mediaUrl: message.mediaUrl as string,
      mediaType: message.mediaType as string | undefined,
    });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'save-to-serpent' || tab?.id === undefined) {
    return;
  }

  const intent = capturedMedia.get(tab.id);
  if (!intent) {
    return;
  }

  capturedMedia.delete(tab.id);

  sendToSerpent(intent);
});

async function sendToSerpent(intent: SaveIntent): Promise<void> {
  for (const port of SERPENT_PORTS) {
    try {
      const response = await fetch(`${SERPENT_HOST}:${port}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intent),
      });

      if (response.status === 202) {
        // Fire-and-forget success — stop scanning.
        return;
      }

      // Server responded but rejected the intent — do not try other ports.
      return;
    } catch {
      // Connection failed (ECONNREFUSED, etc.) — try next port.
      continue;
    }
  }

  // All ports unreachable. Silently ignore; the user will see no feedback
  // but the extension does not assume Serpent is running.
}
