import path from 'node:path';

import { z } from 'zod';

import {
  mcpAccessModeSchema,
  mcpLegacyAccessModeSchema,
  type McpAccessMode,
  type McpCredentialPermission,
  type McpLegacyAccessMode,
} from '../shared/mcp';
import { readAtomicJsonFile, writeAtomicJsonFile } from './atomic-json-file';

const persistedCredentialSchema = z.strictObject({
  credentialId: z.string().uuid(),
  // Legacy 'auto' is accepted on read and mapped to 'read-write'; it is
  // never written back.
  mode: mcpLegacyAccessModeSchema.optional(),
  // Accepted only when reading files written by the abandoned per-capability
  // policy model. It is intentionally never written back.
  policies: z.array(z.unknown()).max(64).optional(),
});

const persistedFileSchema = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  credentials: z.array(persistedCredentialSchema).max(256),
});

const credentialIdSchema = z.string().uuid();

function normalizeMode(mode: McpLegacyAccessMode | undefined): McpAccessMode | undefined {
  if (mode === undefined) return undefined;
  return mode === 'auto' ? 'read-write' : mode;
}

/**
 * Main-owned credential permission profile storage.
 *
 * Profiles are 'read-only' | 'read-write' | 'full-access'. There is no
 * per-call grant cache, session permission, or capability matrix to
 * synchronize with a client.
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
    return this.#modes.get(credentialId) ?? 'read-write';
  }

  public setMode(credentialId: string, mode: McpAccessMode): void {
    credentialIdSchema.parse(credentialId);
    mcpAccessModeSchema.parse(mode);
    if (mode === 'read-write') this.#modes.delete(credentialId);
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
          .map((record) => [record.credentialId, normalizeMode(record.mode)] as const)
          .filter((entry): entry is readonly [string, McpAccessMode] => entry[1] !== undefined),
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
