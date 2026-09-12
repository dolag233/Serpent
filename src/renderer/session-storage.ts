/**
 * Shared localStorage access for the renderer's per-library view sessions
 * (browser scope/selection and workspace tabs). Tests inject a fake store so
 * persistence logic stays free of the DOM.
 */

export type SessionStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function resolveSessionStorage(
  storage?: SessionStorage,
): SessionStorage | null {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: SessionStorage }).localStorage;
  return ls ?? null;
}
