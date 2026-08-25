import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import type { McpClientCredentialSummary } from '../shared/mcp';
import { readAtomicJsonFile, writeAtomicJsonFile } from './atomic-json-file';

const credentialRecordSchema = z.strictObject({
  credentialId: z.string().uuid(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/u),
  tokenCiphertext: z.string().min(1).optional(),
  label: z.string().min(1).max(255),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
type CredentialRecord = z.infer<typeof credentialRecordSchema>;

const credentialFileSchema = z.strictObject({
  version: z.literal(1),
  credentials: z.array(credentialRecordSchema).max(256),
});

const TOKEN_PEPPER_BYTES = 32;
const TOKEN_CIPHER_ALGORITHM = 'aes-256-gcm';
const TOKEN_CIPHER_IV_BYTES = 12;

export type IssuedMcpClientCredential = {
  credentialId: string;
  token: string;
  summary: McpClientCredentialSummary;
};

export type McpCredentialAuthenticationState = 'valid' | 'unknown' | 'revoked';

/**
 * Pure command shape for the pepper-file ACL: replace inheritance and grant
 * full control to the current user only. Kept as a pure builder so the
 * Windows hardening intent is unit-testable on every platform; the win32
 * spawnSync site stays platform-gated (verified on the Windows runner).
 */
export function buildPepperFileAclArgs(filename: string, user: string): string[] {
  return [filename, '/inheritance:r', '/grant:r', `${user}:F`];
}

function hashToken(token: string, pepper: Buffer): string {
  return createHash('sha256').update(pepper).update(token, 'utf8').digest('hex');
}

function encryptToken(token: string, key: Buffer): string {
  const iv = randomBytes(TOKEN_CIPHER_IV_BYTES);
  const cipher = createCipheriv(TOKEN_CIPHER_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decryptToken(encoded: string, key: Buffer): string | undefined {
  const [ivEncoded, tagEncoded, ciphertextEncoded] = encoded.split('.');
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) return undefined;
  try {
    const iv = Buffer.from(ivEncoded, 'base64url');
    const tag = Buffer.from(tagEncoded, 'base64url');
    const ciphertext = Buffer.from(ciphertextEncoded, 'base64url');
    if (iv.byteLength !== TOKEN_CIPHER_IV_BYTES || tag.byteLength !== 16 || ciphertext.byteLength === 0) {
      return undefined;
    }
    const decipher = createDecipheriv(TOKEN_CIPHER_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

function readOrCreatePepper(filename: string): Buffer {
  try {
    const existing = readFileSync(filename);
    if (existing.byteLength === TOKEN_PEPPER_BYTES) return existing;
  } catch {
    // Create the pepper below.
  }
  const pepper = randomBytes(TOKEN_PEPPER_BYTES);
  mkdirSync(path.dirname(filename), { recursive: true });
  try {
    writeFileSync(filename, pepper, { mode: 0o600, flag: 'wx', flush: true });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code !== 'EEXIST') throw error;
    const existing = readFileSync(filename);
    if (existing.byteLength !== TOKEN_PEPPER_BYTES) {
      throw new Error('The MCP credential pepper is invalid.', { cause: error });
    }
    return existing;
  }
  chmodSync(filename, 0o600);
  // Windows review: POSIX mode bits are ignored on NTFS — the pepper (the
  // secret keying every token hash) must get an explicit ACL restricted to
  // the current user, otherwise it inherits the userData directory ACL.
  // Fail-closed: an unreachable/unsuccessful ACL means the token-hash secret
  // may be readable by other local users, so the store refuses to proceed.
  if (process.platform === 'win32') {
    const result = spawnSync('icacls', buildPepperFileAclArgs(
      filename,
      process.env.USERNAME ?? process.env.USER ?? 'Users',
    ), { stdio: 'ignore', windowsHide: true });
    if (result.error !== undefined || result.status !== 0) {
      throw new Error('Failed to restrict the MCP credential pepper ACL to the current user.', {
        cause: result.error,
      });
    }
  }
  return pepper;
}

function summary(record: CredentialRecord): McpClientCredentialSummary {
  return {
    credentialId: record.credentialId,
    label: record.label,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
  };
}

export class McpClientCredentialStore {
  readonly #filePath: string;
  readonly #pepper: Buffer;
  #records: CredentialRecord[] = [];
  #persistTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(userDataPath: string) {
    this.#filePath = path.join(userDataPath, 'mcp-client-credentials.json');
    this.#pepper = readOrCreatePepper(path.join(userDataPath, 'mcp-client-credential-pepper'));
    this.load();
  }

  list(): McpClientCredentialSummary[] {
    return this.#records.map(summary);
  }

  issue(label = 'MCP client'): IssuedMcpClientCredential {
    if (this.#records.length >= 256) {
      throw new Error('The MCP client credential limit of 256 has been reached; revoke an old credential first.');
    }
    const now = new Date().toISOString();
    const token = randomBytes(32).toString('base64url');
    const record: CredentialRecord = {
      credentialId: randomUUID(),
      tokenHash: hashToken(token, this.#pepper),
      tokenCiphertext: encryptToken(token, this.#pepper),
      label: label.trim() || 'MCP client',
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    };
    this.#records = [...this.#records, record].slice(-256);
    this.persist();
    return { credentialId: record.credentialId, token, summary: summary(record) };
  }

  /** Return the stable token for a live credential so it can be copied again. */
  tokenFor(credentialId: string): string | undefined {
    const record = this.#records.find((candidate) => candidate.credentialId === credentialId);
    if (record === undefined || record.revokedAt !== null) return undefined;
    if (record.tokenCiphertext === undefined) {
      return undefined;
    }
    const token = decryptToken(record.tokenCiphertext, this.#pepper);
    if (token === undefined || hashToken(token, this.#pepper) !== record.tokenHash) return undefined;
    return token;
  }

  authenticate(token: string): CredentialRecord | undefined {
    const record = this.findByToken(token);
    if (record === undefined || record.revokedAt !== null) return undefined;
    record.lastUsedAt = new Date().toISOString();
    // Serpent review: a chatty agent would otherwise rewrite the whole file
    // on every request; coalesce lastUsedAt updates into one write.
    if (this.#persistTimer === undefined) {
      this.#persistTimer = setTimeout(() => {
        this.#persistTimer = undefined;
        this.persist();
      }, 5_000);
      this.#persistTimer.unref();
    }
    return { ...record };
  }

  authenticationState(token: string): McpCredentialAuthenticationState {
    const record = this.findByToken(token);
    if (record === undefined) return 'unknown';
    return record.revokedAt === null ? 'valid' : 'revoked';
  }

  revoke(credentialId: string): boolean {
    const record = this.#records.find((candidate) => candidate.credentialId === credentialId);
    if (record === undefined || record.revokedAt !== null) return false;
    record.revokedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  /** Rename a live credential's display label. */
  rename(credentialId: string, label: string): boolean {
    const record = this.#records.find((candidate) => candidate.credentialId === credentialId);
    if (record === undefined || record.revokedAt !== null) return false;
    const trimmed = label.trim();
    if (trimmed.length === 0 || trimmed.length > 255) return false;
    record.label = trimmed;
    this.persist();
    return true;
  }

  private load(): void {
    try {
      const contents = readAtomicJsonFile(this.#filePath);
      if (contents === undefined) return;
      const parsed = credentialFileSchema.safeParse(JSON.parse(contents));
      if (parsed.success) this.#records = parsed.data.credentials;
    } catch {
      this.#records = [];
    }
  }

  private findByToken(token: string): CredentialRecord | undefined {
    const candidateHash = Buffer.from(hashToken(token, this.#pepper), 'hex');
    return this.#records.find((candidate) => {
      const storedHash = Buffer.from(candidate.tokenHash, 'hex');
      return storedHash.byteLength === candidateHash.byteLength
        && timingSafeEqual(storedHash, candidateHash);
    });
  }

  private persist(): void {
    if (this.#persistTimer !== undefined) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = undefined;
    }
    writeAtomicJsonFile(
      this.#filePath,
      JSON.stringify({ version: 1, credentials: this.#records }, null, 2),
    );
  }
}
