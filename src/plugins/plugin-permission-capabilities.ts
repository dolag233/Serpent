import {
  automationCapabilitySchema,
  type AutomationCapability,
} from '../automation/command-registry';
import type { PluginPermission } from './plugin-manifest';

/**
 * Maps declared plugin permissions onto Automation Gateway capabilities.
 * Permissions without a Gateway counterpart (net.fetch, UI, secrets, …) are
 * ignored here: they are enforced by later Host/API surfaces, not by Gateway.
 */
export function automationCapabilitiesFromPluginPermissions(
  permissions: readonly PluginPermission[],
): AutomationCapability[] {
  const allowed = new Set<string>(automationCapabilitySchema.options);
  const granted = new Set<AutomationCapability>();
  for (const permission of permissions) {
    if (allowed.has(permission)) {
      granted.add(permission as AutomationCapability);
    }
  }
  return [...granted].sort();
}
