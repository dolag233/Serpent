import path from 'node:path';

import { z } from 'zod';

import {
  MCP_DEFAULT_PORT,
  mcpServerPreferencesSchema,
  type McpServerPreferences,
} from '../shared/mcp';
import { readAtomicJsonFile, writeAtomicJsonFile } from './atomic-json-file';

const persistedMcpSettingsSchema = z.strictObject({
  version: z.literal(1),
  // Keep the field optional on disk so a pre-toggle settings file migrates
  // without resetting the user's enabled/port/auto-start choices.
  preferences: z.strictObject({
    enabled: z.boolean(),
    autoStart: z.boolean(),
    skipApproval: z.boolean().optional(),
    port: z.number().int().min(1024).max(65_535),
  }),
});

const DEFAULT_PREFERENCES: McpServerPreferences = {
  enabled: false,
  autoStart: false,
  port: MCP_DEFAULT_PORT,
};

export class McpSettingsStore {
  readonly #filePath: string;
  #preferences: McpServerPreferences = { ...DEFAULT_PREFERENCES };

  constructor(userDataPath: string) {
    this.#filePath = path.join(userDataPath, 'mcp-settings.json');
    this.load();
  }

  get preferences(): McpServerPreferences {
    return { ...this.#preferences };
  }

  setPreferences(patch: Partial<McpServerPreferences>): McpServerPreferences {
    const next = mcpServerPreferencesSchema.parse({ ...this.#preferences, ...patch });
    this.#preferences = next;
    this.persist();
    return this.preferences;
  }

  private load(): void {
    try {
      const contents = readAtomicJsonFile(this.#filePath);
      if (contents === undefined) return;
      const parsed = persistedMcpSettingsSchema.safeParse(
        JSON.parse(contents),
      );
      if (parsed.success) {
        const preferences = { ...parsed.data.preferences };
        delete preferences.skipApproval;
        this.#preferences = preferences;
      }
    } catch {
      this.#preferences = { ...DEFAULT_PREFERENCES };
    }
  }

  private persist(): void {
    writeAtomicJsonFile(
      this.#filePath,
      JSON.stringify({ version: 1, preferences: this.#preferences }, null, 2),
    );
  }
}
