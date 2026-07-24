import { folderMenuLabel, type ExtensionFolderOption } from './folder-menu';
import type { MediaTarget } from './media-target';
import type { SaveIntent } from './save-client';

const MENU_ROOT_LABEL = '保存到 Serpent';
const ROOT_FOLDER_LABEL = '根目录';

interface FolderListResponse {
  kind: 'ok';
  folders: ExtensionFolderOption[];
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

function createMenuShell(clientX: number, clientY: number): {
  host: HTMLDivElement;
  list: HTMLUListElement;
  dispose: () => void;
} {
  const host = document.createElement('div');
  host.setAttribute('data-serpent-overlay-menu', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: `${clientX}px`,
    top: `${clientY}px`,
    zIndex: '2147483647',
    minWidth: '220px',
    maxWidth: '320px',
    maxHeight: 'min(70vh, 420px)',
    overflowY: 'auto',
    background: '#1f1f1f',
    color: '#f5f5f5',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
    padding: '6px 0',
    font: '13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif',
  });

  const title = document.createElement('div');
  title.textContent = MENU_ROOT_LABEL;
  Object.assign(title.style, {
    padding: '6px 12px 8px',
    fontWeight: '600',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    marginBottom: '4px',
  });
  host.appendChild(title);

  const list = document.createElement('ul');
  Object.assign(list.style, {
    listStyle: 'none',
    margin: '0',
    padding: '0',
  });
  host.appendChild(list);
  document.documentElement.appendChild(host);

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Node && host.contains(target)) return;
    dispose();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') dispose();
  };

  const dispose = () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    host.remove();
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);

  return { host, list, dispose };
}

function appendMenuItem(
  list: HTMLUListElement,
  label: string,
  onSelect: () => void,
): void {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  Object.assign(button.style, {
    display: 'block',
    width: '100%',
    border: '0',
    background: 'transparent',
    color: 'inherit',
    textAlign: 'left',
    padding: '8px 12px',
    cursor: 'pointer',
    font: 'inherit',
  });
  button.addEventListener('mouseenter', () => {
    button.style.background = 'rgba(255,255,255,0.08)';
  });
  button.addEventListener('mouseleave', () => {
    button.style.background = 'transparent';
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
  });
  item.appendChild(button);
  list.appendChild(item);
}

async function requestSave(
  media: MediaTarget,
  targetFolderId: string | null,
): Promise<void> {
  const intent: SaveIntent = {
    kind: media.kind,
    sourcePageUrl: window.location.href,
    mediaUrl: media.mediaUrl,
    targetFolderId,
  };
  await sendRuntimeMessage<SaveResponse>({
    type: 'serpent-save-request',
    intent,
  });
}

export async function showOverlaySaveMenu(
  clientX: number,
  clientY: number,
  media: MediaTarget,
): Promise<void> {
  const { list, dispose } = createMenuShell(clientX, clientY);

  const closeAfter = async (action: () => Promise<void>) => {
    try {
      await action();
    } finally {
      dispose();
    }
  };

  appendMenuItem(list, ROOT_FOLDER_LABEL, () => {
    void closeAfter(async () => {
      await requestSave(media, null);
    });
  });

  try {
    const foldersResponse = await sendRuntimeMessage<
      FolderListResponse | FolderListErrorResponse
    >({ type: 'serpent-list-folders' });

    if (foldersResponse.kind === 'ok') {
      for (const folder of foldersResponse.folders) {
        appendMenuItem(list, folderMenuLabel(folder), () => {
          void closeAfter(async () => {
            await requestSave(media, folder.folderId);
          });
        });
      }
    }
  } catch {
    // Root folder remains available even when folder list fails.
  }
}
