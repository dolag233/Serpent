import { contextBridge } from 'electron';

import { appUpdate } from './bridge/app-update';
import { automation } from './bridge/automation';
import {
  armE2eBrowseSessionDelay,
  library,
  type E2eBrowseSessionDelayTarget,
} from './bridge/library';
import { mcp } from './bridge/mcp';
import { plugins } from './bridge/plugins';
import { shell } from './bridge/shell';
import { getE2eRequestCount } from './transport';
import type { RendererRequest } from '../shared/protocol/requests';

const e2eEnabled = process.env.SERPENT_E2E === '1';

const e2eDiagnostics = Object.freeze({
  getRequestCount(type: RendererRequest['type']): number {
    return getE2eRequestCount(type);
  },
  delayNextBrowseSession(
    target: E2eBrowseSessionDelayTarget,
    delayMs: number,
  ): void {
    if (
      !e2eEnabled ||
      !Number.isInteger(delayMs) ||
      delayMs < 0 ||
      delayMs > 5_000 ||
      (target.folderId === undefined) ===
        (target.smartCollectionId === undefined)
    ) {
      throw new Error('Invalid E2E browse-session delay.');
    }
    armE2eBrowseSessionDelay(target, delayMs);
  },
});

contextBridge.exposeInMainWorld(
  'serpent',
  Object.freeze({
    library,
    shell,
    appUpdate,
    automation,
    mcp,
    plugins,
    ...(e2eEnabled ? { e2e: e2eDiagnostics } : {}),
  }),
);
