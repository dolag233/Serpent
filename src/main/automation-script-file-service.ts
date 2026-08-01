import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { utf8ByteLength } from '../shared/script-sandbox-limits';
import type { AutomationRecentScriptsStore } from './automation-recent-scripts-store';

const MAX_SCRIPT_SOURCE_BYTES = 64 * 1024;
const scriptFilenamePattern = /\.serpent\.(?:js|ts)$/iu;

export type AutomationScriptFileResult =
  | { ok: true; scriptId: string; displayName: string; source: string }
  | { ok: false; code: 'cancelled' | 'invalid-script-file' | 'source-too-large' | 'io-failed' | 'recent-script-not-found' };

type StoredScript = {
  senderId: number;
  displayName: string;
  source: string;
};

export interface AutomationScriptFileServiceOptions {
  selectOpenScript(): Promise<string | undefined>;
  selectSaveScript(): Promise<string | undefined>;
  recentScripts?: AutomationRecentScriptsStore;
  newScriptId?(): string;
}

/**
 * Main-owned file picker and source binding for saved Serpent scripts.
 *
 * Renderer receives source text and a display name, never the selected path.
 * The opaque handle is sender-bound and tied to the exact text Main read or
 * wrote, so a Console caller cannot label arbitrary code as a saved script to
 * inherit a persistent saved-script grant.
 */
export class AutomationScriptFileService {
  readonly #scripts = new Map<string, StoredScript>();
  readonly #newScriptId: () => string;

  constructor(private readonly options: AutomationScriptFileServiceOptions) {
    this.#newScriptId = options.newScriptId ?? randomUUID;
  }

  async open(senderId: number): Promise<AutomationScriptFileResult> {
    const filename = await this.options.selectOpenScript();
    if (filename === undefined) return { ok: false, code: 'cancelled' };
    return this.#readAndStore(senderId, filename);
  }

  async openRecent(senderId: number, handle: string): Promise<AutomationScriptFileResult> {
    const filename = this.options.recentScripts?.resolvePath(handle);
    if (filename === undefined) return { ok: false, code: 'recent-script-not-found' };
    return this.#readAndStore(senderId, filename);
  }

  async save(input: { senderId: number; source: string }): Promise<AutomationScriptFileResult> {
    if (utf8ByteLength(input.source) > MAX_SCRIPT_SOURCE_BYTES) {
      return { ok: false, code: 'source-too-large' };
    }
    const filename = await this.options.selectSaveScript();
    if (filename === undefined) return { ok: false, code: 'cancelled' };
    if (!isSupportedScriptFilename(filename)) return { ok: false, code: 'invalid-script-file' };
    try {
      await writeFile(filename, input.source, { encoding: 'utf8', mode: 0o600 });
    } catch {
      return { ok: false, code: 'io-failed' };
    }
    return this.#store(input.senderId, filename, input.source);
  }

  listRecent() {
    return this.options.recentScripts?.list() ?? [];
  }

  resolveForExecution(input: { senderId: number; scriptId: string; source: string }): Pick<StoredScript, 'displayName' | 'source'> | undefined {
    const script = this.#scripts.get(input.scriptId);
    if (!script || script.senderId !== input.senderId || script.source !== input.source) return undefined;
    return { displayName: script.displayName, source: script.source };
  }

  releaseSender(senderId: number): void {
    for (const [scriptId, script] of this.#scripts) {
      if (script.senderId === senderId) this.#scripts.delete(scriptId);
    }
  }

  async #readAndStore(senderId: number, filename: string): Promise<AutomationScriptFileResult> {
    if (!isSupportedScriptFilename(filename)) return { ok: false, code: 'invalid-script-file' };
    let source: string;
    try {
      source = await readFile(filename, 'utf8');
    } catch {
      return { ok: false, code: 'io-failed' };
    }
    if (utf8ByteLength(source) > MAX_SCRIPT_SOURCE_BYTES) {
      return { ok: false, code: 'source-too-large' };
    }
    return this.#store(senderId, filename, source);
  }

  #store(senderId: number, filename: string, source: string): AutomationScriptFileResult {
    const scriptId = this.#newScriptId();
    const displayName = path.basename(filename);
    this.#scripts.set(scriptId, { senderId, displayName, source });
    this.options.recentScripts?.record(displayName, filename);
    return { ok: true, scriptId, displayName, source };
  }
}

export function isSupportedScriptFilename(filename: string): boolean {
  return scriptFilenamePattern.test(path.basename(filename));
}
