import { describe, expect, it } from 'vitest';

import {
  parseExtensionPairingRequest,
  parseExtensionPairingResult,
} from '../../src/shared/extension-pairing';

describe('extension pairing IPC protocol', () => {
  it('accepts only the two semantic pairing operations', () => {
    expect(parseExtensionPairingRequest({ type: 'extension-pairing.get' })).toEqual({
      type: 'extension-pairing.get',
    });
    expect(parseExtensionPairingRequest({ type: 'extension-pairing.rotate' })).toEqual({
      type: 'extension-pairing.rotate',
    });
    expect(() => parseExtensionPairingRequest({ type: 'extension-pairing.get', path: '/tmp' }))
      .toThrow();
  });

  it('rejects malformed or low-entropy-looking token responses', () => {
    const token = 'a'.repeat(43);
    expect(parseExtensionPairingResult({ ok: true, token })).toEqual({ ok: true, token });
    expect(parseExtensionPairingResult({ ok: false, message: 'Pairing unavailable.' })).toEqual({
      ok: false,
      message: 'Pairing unavailable.',
    });
    expect(() => parseExtensionPairingResult({ ok: true, token: 'short' })).toThrow();
    expect(() => parseExtensionPairingResult({ ok: false, message: '', token })).toThrow();
  });
});
