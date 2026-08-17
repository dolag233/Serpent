export type PluginStorageOperation = 'get' | 'set' | 'delete' | 'list' | 'get-directory';

/**
 * Storage IPC uses operation envelopes, but the public Guest API exposes the
 * value represented by each operation. Keep this projection at the runtime
 * boundary so restricted and unrestricted plugins observe the same contract.
 */
export function projectPluginStorageResult(
  operation: PluginStorageOperation,
  result: unknown,
): unknown {
  if (operation === 'get') {
    if (result !== null && typeof result === 'object' && !Array.isArray(result)
      && Object.prototype.hasOwnProperty.call(result, 'value')) {
      return (result as { value: unknown }).value;
    }
    return result;
  }
  if (operation === 'set') return undefined;
  if (operation === 'delete') {
    if (result !== null && typeof result === 'object' && !Array.isArray(result)
      && Object.prototype.hasOwnProperty.call(result, 'deleted')) {
      return (result as { deleted: unknown }).deleted;
    }
    return result;
  }
  if (operation === 'list') {
    if (result !== null && typeof result === 'object' && !Array.isArray(result)
      && Object.prototype.hasOwnProperty.call(result, 'keys')) {
      return (result as { keys: unknown }).keys;
    }
    return result;
  }
  return result;
}
