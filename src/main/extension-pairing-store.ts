import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export class ExtensionPairingStore {
  private token: string | undefined;

  constructor(
    private readonly encryptedPath: string,
    private readonly safeStorage: SafeStorageAdapter,
  ) {}

  current(): string {
    if (this.token) return this.token;
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Operating-system encryption is unavailable for browser-extension pairing.');
    }

    if (existsSync(this.encryptedPath)) {
      try {
        const decrypted = this.safeStorage.decryptString(readFileSync(this.encryptedPath));
        if (TOKEN_PATTERN.test(decrypted)) {
          this.token = decrypted;
          return decrypted;
        }
      } catch {
        // Corrupt or machine-bound ciphertext is replaced with a fresh token.
      }
    }
    return this.rotate();
  }

  rotate(): string {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Operating-system encryption is unavailable for browser-extension pairing.');
    }
    const next = randomBytes(32).toString('base64url');
    const encrypted = this.safeStorage.encryptString(next);
    const temporaryPath = `${this.encryptedPath}.tmp`;
    try {
      writeFileSync(temporaryPath, encrypted, { mode: 0o600 });
      chmodSync(temporaryPath, 0o600);
      renameSync(temporaryPath, this.encryptedPath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
    this.token = next;
    return next;
  }
}
