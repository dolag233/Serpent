import { describe, expect, it } from 'vitest';

import { isValidPairingToken, normalizePairingToken } from '../../extension/pairing-token';

describe('extension pairing token input', () => {
  it('trims a valid desktop pairing token', () => {
    const token = 'a'.repeat(43);
    expect(normalizePairingToken(`  ${token}\n`)).toBe(token);
    expect(isValidPairingToken(`  ${token}\n`)).toBe(true);
  });

  it.each(['', 'short', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}!`])(
    'rejects malformed token %j',
    (token) => expect(isValidPairingToken(token)).toBe(false),
  );
});
