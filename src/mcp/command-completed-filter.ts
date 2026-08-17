import { getAutomationCommandDescriptor } from '../automation/command-registry';

/**
 * Serpent-fmbr: whether a completed MCP tool call should surface on the
 * desktop. Only executed non-read commands emit — reads have no manual toast
 * to mirror, and a phase-1 two-phase challenge report is an ok result that
 * executed nothing yet (the confirmed second call emits the real completion).
 */
export function shouldEmitCommandCompleted(commandId: string, result: unknown): boolean {
  if (typeof result === 'object' && result !== null
    && (result as { status?: unknown }).status === 'confirmation-required') {
    return false;
  }
  const descriptor = getAutomationCommandDescriptor(commandId);
  return descriptor !== undefined && descriptor.impact !== 'read';
}
