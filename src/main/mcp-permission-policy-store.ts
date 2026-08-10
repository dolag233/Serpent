import path from 'node:path';

import { z } from 'zod';

import { mcpAccessModeSchema, type McpAccessMode, type McpCredentialPermission } from '../shared/mcp';
import { readAtomicJsonFile, writeAtomicJsonFile } from './atomic-json-file';

const persistedCredentialSchema = z.strictObject({
  credentialId: z.string().uuid(),
  mode: mcpAccessModeSchema.optional(),
  // Accepted only when reading files written by the abandoned per-capability
  // policy model. It is intentionally never written back.
  policies: z.array(z.unknown()).max(64).optional(),
});

const persistedFileSchema = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  credentials: z.array(persistedCredentialSchema).max(256),
});

const credentialIdSchema = z.string().uuid();

/**
 * Main-owned credential access mode storage.
 *
 * The MCP runtime has exactly two modes. There is no per-call grant cache,
 * session permission, or capability matrix to synchronize with a client.
 */
export class McpPermissionPolicyStore {
  readonly #filePath: string;
  #modes = new Map<string, McpAccessMode>();

  public constructor(userDataPath: string) {
    this.#filePath = path.join(userDataPath, 'mcp-permission-policies.json');
    this.#load();
  }

  public getMode(credentialId: string): McpAccessMode {
    credentialIdSchema.parse(credentialId);
    return this.#modes.get(credentialId) ?? 'auto';
  }

  public setMode(credentialId: string, mode: McpAccessMode): void {
    credentialIdSchema.parse(credentialId);
    mcpAccessModeSchema.parse(mode);
    if (mode === 'auto') this.#modes.delete(credentialId);
    else this.#modes.set(credentialId, mode);
    this.#persist();
  }

  public clearCredential(credentialId: string): void {
    credentialIdSchema.parse(credentialId);
    if (this.#modes.delete(credentialId)) this.#persist();
  }

  public snapshot(credentialId: string): McpCredentialPermission {
    credentialIdSchema.parse(credentialId);
    return { credentialId, mode: this.getMode(credentialId) };
  }

  public snapshots(credentialIds: readonly string[]): McpCredentialPermission[] {
    return credentialIds.map((credentialId) => this.snapshot(credentialId));
  }

  #load(): void {
    try {
      const contents = readAtomicJsonFile(this.#filePath);
      if (contents === undefined) return;
      const parsed = persistedFileSchema.safeParse(JSON.parse(contents));
      if (!parsed.success) return;
      this.#modes = new Map(
        parsed.data.credentials
          .filter((record) => record.mode !== undefined)
          .map((record) => [record.credentialId, record.mode!]),
      );
    } catch {
      this.#modes = new Map();
    }
  }

  #persist(): void {
    writeAtomicJsonFile(
      this.#filePath,
      JSON.stringify({
        version: 2,
        credentials: [...this.#modes.entries()].map(([credentialId, mode]) => ({ credentialId, mode })),
      }, null, 2),
    );
  }
}
