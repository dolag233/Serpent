import { z } from 'zod';

/** Canonical plugin capability tiers (wire + in-memory). */
export const PLUGIN_RUNTIME_MODES = ['restricted', 'unrestricted'] as const;
export type PluginRuntimeMode = (typeof PLUGIN_RUNTIME_MODES)[number];

/** Legacy manifest / device-state aliases accepted on read. */
export const PLUGIN_RUNTIME_MODE_ALIASES = {
  standard: 'restricted',
  trusted: 'unrestricted',
} as const;

export function normalizePluginRuntimeMode(value: string): PluginRuntimeMode {
  if (value === 'restricted' || value === 'standard') return 'restricted';
  if (value === 'unrestricted' || value === 'trusted') return 'unrestricted';
  throw new Error(`Unsupported plugin runtime mode: ${value}`);
}

export function isUnrestrictedPluginRuntimeMode(mode: string): boolean {
  return normalizePluginRuntimeMode(mode) === 'unrestricted';
}

export function isRestrictedPluginRuntimeMode(mode: string): boolean {
  return normalizePluginRuntimeMode(mode) === 'restricted';
}

/**
 * Zod helper: accept canonical modes and legacy aliases, always emit canonical.
 */
export const pluginRuntimeModeSchema = z.string().transform((value, ctx) => {
  try {
    return normalizePluginRuntimeMode(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: `Unsupported plugin runtime mode: ${value}` });
    return z.NEVER;
  }
});
