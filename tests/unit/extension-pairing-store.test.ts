import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ExtensionPairingStore, type SafeStorageAdapter } from '../../src/main/extension-pairing-store';

function fakeSafeStorage(): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
    decryptString: (value) => Buffer.from(
      value.toString().replace(/^encrypted:/u, ''),
      'base64',
    ).toString(),
  };
}

describe('ExtensionPairingStore', () => {
  it('generates a high-entropy token and persists only ciphertext', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-pairing-'));
    const encryptedPath = path.join(root, 'pairing.enc');
    const store = new ExtensionPairingStore(encryptedPath, fakeSafeStorage());
    const token = store.current();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(readFileSync(encryptedPath, 'utf8')).not.toContain(token);
    expect(new ExtensionPairingStore(encryptedPath, fakeSafeStorage()).current()).toBe(token);
  });

  it('rotates to a different token and replaces corrupt ciphertext', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-pairing-'));
    const encryptedPath = path.join(root, 'pairing.enc');
    const store = new ExtensionPairingStore(encryptedPath, fakeSafeStorage());
    const first = store.current();
    expect(store.rotate()).not.toBe(first);

    writeFileSync(encryptedPath, 'corrupt');
    expect(new ExtensionPairingStore(encryptedPath, fakeSafeStorage()).current()).toMatch(
      /^[A-Za-z0-9_-]{43}$/u,
    );
  });

  it('fails closed when operating-system encryption is unavailable', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-pairing-'));
    const unavailable: SafeStorageAdapter = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    };
    const store = new ExtensionPairingStore(path.join(root, 'pairing.enc'), unavailable);
    expect(() => store.current()).toThrow('encryption is unavailable');
    expect(() => store.rotate()).toThrow('encryption is unavailable');
  });
});
