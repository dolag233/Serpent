import { getAutomationCommandDescriptor } from '../automation/command-registry';

import {
  PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID,
  pluginTargetLibraryIdSchema,
} from './plugin-commands';

export { PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID };

/**
 * Library-mutating plugin commands still need an open library (via ambient
 * library scope or `serpent.forLibrary()`). Main-owned commands with
 * `libraryContext: 'none'` — `ui.notify`, `ui.dialog`, `ui.widget-patch`,
 * `media.binaries.get` — must work from a global plugin's ambient API.
 */
export function pluginHostCommandRequiresBoundLibrary(commandId: string): boolean {
  const descriptor = getAutomationCommandDescriptor(commandId);
  if (descriptor === undefined) return true;
  const libraryContext = descriptor.libraryContext
    ?? (descriptor.targetScope === 'library'
      || descriptor.targetScope === 'asset'
      || descriptor.targetScope === 'asset-set'
      || descriptor.targetScope === 'job-set'
      ? 'active'
      : 'none');
  return libraryContext !== 'none';
}

export type PluginHostCommandLibraryTarget =
  | { ok: true; libraryId: string | null }
  | { ok: false; message: string };

export function resolvePluginHostCommandLibraryId(input: {
  commandId: string;
  libraryId: string;
  targetLibraryId?: string;
}): PluginHostCommandLibraryTarget {
  const requiresBound = pluginHostCommandRequiresBoundLibrary(input.commandId);
  const candidate = input.targetLibraryId ?? input.libraryId;
  if (!requiresBound) {
    if (candidate === PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID || candidate.length === 0) {
      return { ok: true, libraryId: null };
    }
    const parsed = pluginTargetLibraryIdSchema.safeParse(candidate);
    return parsed.success
      ? { ok: true, libraryId: parsed.data }
      : { ok: true, libraryId: null };
  }
  if (candidate === PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID) {
    return {
      ok: false,
      message: 'A global plugin must choose an open library with serpent.forLibrary().',
    };
  }
  const parsed = pluginTargetLibraryIdSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, message: 'The plugin command target library is invalid.' };
  }
  return { ok: true, libraryId: parsed.data };
}
