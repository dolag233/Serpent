import { readAtomicJsonFile, writeAtomicJsonFile } from './atomic-json-file';
import path from 'node:path';

import { z } from 'zod';

import { pluginIdSchema, pluginLocalIdSchema } from '../plugins/plugin-manifest';

const EXPOSURE_FILE_NAME = 'plugin-mcp-exposure.json';
const EXPOSURE_FILE_VERSION = 1 as const;
const MAX_EXPOSURES = 4_096;

const exposureEntrySchema = z.strictObject({
  pluginId: pluginIdSchema,
  commandId: pluginLocalIdSchema,
});
const exposureDocumentSchema = z.strictObject({
  version: z.literal(EXPOSURE_FILE_VERSION),
  enabled: z.array(exposureEntrySchema).max(MAX_EXPOSURES),
});

export type PluginMcpExposureEntry = z.infer<typeof exposureEntrySchema>;

/**
 * Device-local MCP consent. It intentionally has no generic value bag, path,
 * credential, or plugin-writable storage surface.
 */
export class PluginMcpExposureStore {
  readonly #filePath: string;
  readonly #enabled = new Set<string>();

  constructor(userDataDirectory: string) {
    this.#filePath = path.join(userDataDirectory, EXPOSURE_FILE_NAME);
  }

  async load(): Promise<void> {
    const contents = readAtomicJsonFile(this.#filePath);
    if (contents === undefined) return;
    let raw: unknown;
    try {
      raw = JSON.parse(contents);
    } catch {
      this.#enabled.clear();
      return;
    }
    const parsed = exposureDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      // Fail closed if a stale or hand-edited file is malformed.
      this.#enabled.clear();
      return;
    }
    this.#enabled.clear();
    for (const entry of parsed.data.enabled) this.#enabled.add(keyFor(entry));
  }

  isEnabled(pluginId: string, commandId: string): boolean {
    return this.#enabled.has(keyFor({ pluginId, commandId }));
  }

  async setEnabled(input: PluginMcpExposureEntry & { enabled: boolean }): Promise<void> {
    const entry = exposureEntrySchema.parse({
      pluginId: input.pluginId,
      commandId: input.commandId,
    });
    const key = keyFor(entry);
    if (input.enabled) this.#enabled.add(key);
    else this.#enabled.delete(key);
    await this.#write();
  }

  listEnabled(): PluginMcpExposureEntry[] {
    return [...this.#enabled]
      .map((value) => {
        const separator = value.indexOf('\u0000');
        return {
          pluginId: value.slice(0, separator),
          commandId: value.slice(separator + 1),
        };
      })
      .sort((left, right) => `${left.pluginId}.${left.commandId}`.localeCompare(`${right.pluginId}.${right.commandId}`));
  }

  async #write(): Promise<void> {
    const contents = `${JSON.stringify(exposureDocumentSchema.parse({
      version: EXPOSURE_FILE_VERSION,
      enabled: this.listEnabled(),
    }), null, 2)}\n`;
    // Reuse the shared crash-safe replacement policy. In particular, a plain
    // rename(staging, destination) is not a replace operation on Windows.
    writeAtomicJsonFile(this.#filePath, contents);
  }
}

function keyFor(input: PluginMcpExposureEntry): string {
  return `${pluginIdSchema.parse(input.pluginId)}\u0000${pluginLocalIdSchema.parse(input.commandId)}`;
}
