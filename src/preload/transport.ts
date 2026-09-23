import { ipcRenderer } from 'electron';

import type { LibraryApiResult } from '../shared/library-api';
import { LIBRARY_REQUEST_CHANNEL } from '../shared/protocol/channels';
import type { RendererRequest } from '../shared/protocol/requests';
import {
  parseRendererResult,
  type ImportCompletion,
  type ImportConflictPlan,
  type ImportSourceFailurePlan,
  type ImageSequenceImportOffer,
  type RendererResult,
} from '../shared/protocol/responses';

const e2eEnabled = process.env.SERPENT_E2E === '1';
const requestCounts = new Map<RendererRequest['type'], number>();

export async function request(command: RendererRequest): Promise<RendererResult> {
  if (e2eEnabled) {
    requestCounts.set(command.type, (requestCounts.get(command.type) ?? 0) + 1);
  }
  return parseRendererResult(await ipcRenderer.invoke(LIBRARY_REQUEST_CHANNEL, command));
}

export function failure(result: Extract<RendererResult, { ok: false }>): LibraryApiResult<never> {
  return { ok: false, error: result.error };
}

export function getE2eRequestCount(type: RendererRequest['type']): number {
  return requestCounts.get(type) ?? 0;
}

type ImportRendererRequest = Extract<RendererRequest, {
  type:
    | 'asset.import-files.request'
    | 'asset.import-folder.request'
    | 'asset.import-drop.request'
    | 'asset.import-web.request'
    | 'asset.import-clipboard.request'
    | 'asset.import-sequence.confirm'
    | 'folder.paste.request';
}>;

export async function importRequest(
  command: ImportRendererRequest,
): Promise<LibraryApiResult<ImportCompletion | ImportConflictPlan | ImportSourceFailurePlan | ImageSequenceImportOffer>> {
  const result = await request(command);
  if (!result.ok) return failure(result);
  if (result.type === 'asset.import.completed') return { ok: true, value: result.completion };
  if (result.type === 'asset.import.conflicts') return { ok: true, value: result.plan };
  if (result.type === 'asset.import.source-failure') return { ok: true, value: result.plan };
  if (result.type === 'asset.import.sequence-offer') return { ok: true, value: result.offer };
  if (result.type === 'extension.asset-saved') {
    return {
      ok: true,
      value: {
        importedCount: 1,
        fileCount: 1,
        assetCount: 1,
        skippedCount: 0,
        replacedCount: 0,
        assets: [result.asset],
      },
    };
  }
  throw new Error('Unexpected prepare-import response.');
}
