import { contextBridge, ipcRenderer } from 'electron';

import type { LibraryApiResult, SerpentLibraryApi } from '../shared/library-api';
import {
  LIBRARY_LIFECYCLE_CHANNEL,
  LIBRARY_REQUEST_CHANNEL,
} from '../shared/protocol/channels';
import type { RendererRequest } from '../shared/protocol/requests';
import {
  parseRendererResult,
  parseRendererLifecycleEvent,
  type RendererLibrarySummary,
  type RendererLifecycleEvent,
  type RendererResult,
} from '../shared/protocol/responses';

async function request(command: RendererRequest): Promise<RendererResult> {
  return parseRendererResult(await ipcRenderer.invoke(LIBRARY_REQUEST_CHANNEL, command));
}

function failure(result: Extract<RendererResult, { ok: false }>): LibraryApiResult<never> {
  return { ok: false, error: result.error };
}

const library: SerpentLibraryApi = Object.freeze({
  async create({
    displayName,
  }: {
    displayName: string;
  }): Promise<LibraryApiResult<RendererLibrarySummary>> {
    const result = await request({ type: 'library.create.request', displayName });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.opened') throw new Error('Unexpected create-library response.');
    return { ok: true as const, value: result.library };
  },

  async open(): Promise<LibraryApiResult<RendererLibrarySummary>> {
    const result = await request({ type: 'library.open.request' });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.opened') throw new Error('Unexpected open-library response.');
    return { ok: true as const, value: result.library };
  },

  async close({
    libraryId,
  }: {
    libraryId: string;
  }): Promise<LibraryApiResult<{ libraryId: string }>> {
    const result = await request({ type: 'library.close.request', libraryId });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.closed') throw new Error('Unexpected close-library response.');
    return { ok: true as const, value: { libraryId: result.libraryId } };
  },

  async listOpen(): Promise<LibraryApiResult<RendererLibrarySummary[]>> {
    const result = await request({ type: 'library.list.request' });
    if (!result.ok) return failure(result);
    if (result.type !== 'library.list') throw new Error('Unexpected list-libraries response.');
    return { ok: true as const, value: result.libraries };
  },

  onLifecycle(listener: (event: RendererLifecycleEvent) => void) {
    const subscription = (_event: Electron.IpcRendererEvent, input: unknown) => {
      listener(parseRendererLifecycleEvent(input));
    };
    ipcRenderer.on(LIBRARY_LIFECYCLE_CHANNEL, subscription);
    return () => ipcRenderer.removeListener(LIBRARY_LIFECYCLE_CHANNEL, subscription);
  },
});

contextBridge.exposeInMainWorld('serpent', Object.freeze({ library }));
