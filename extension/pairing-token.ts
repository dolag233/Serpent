export const PAIRING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function normalizePairingToken(value: string): string {
  return value.trim();
}

export function isValidPairingToken(value: string): boolean {
  return PAIRING_TOKEN_PATTERN.test(normalizePairingToken(value));
}
