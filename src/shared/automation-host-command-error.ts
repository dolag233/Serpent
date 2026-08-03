import { z } from 'zod';

import {
  createPublicError,
  publicErrorSchema,
  type PublicError,
} from './protocol/errors';

/**
 * Errors which the Automation Gateway may return before a Worker command is
 * dispatched. Keep this list explicit: runtime boundaries must not forward an
 * arbitrary internal error code or message to a script.
 */
export const automationGatewayErrorCodeSchema = z.enum([
  'AUTOMATION_INVALID_REQUEST',
  'AUTOMATION_API_VERSION_UNSUPPORTED',
  'AUTOMATION_COMMAND_NOT_FOUND',
  'AUTOMATION_EXECUTION_NOT_FOUND',
  'AUTOMATION_SOURCE_NOT_ALLOWED',
  'AUTOMATION_CAPABILITY_DENIED',
  'AUTOMATION_LIBRARY_NOT_BOUND',
  'AUTOMATION_LIBRARY_OPEN_FAILED',
  'AUTOMATION_CONCURRENCY_LIMIT_REACHED',
  'AUTOMATION_EXECUTION_CANCELLED',
  'AUTOMATION_EXECUTION_TIMED_OUT',
  'AUTOMATION_RESULT_INVALID',
]);
export type AutomationGatewayErrorCode = z.infer<typeof automationGatewayErrorCodeSchema>;

export const AUTOMATION_GATEWAY_ERROR_MESSAGES: Readonly<Record<AutomationGatewayErrorCode, string>> = {
  AUTOMATION_INVALID_REQUEST: 'The automation command request is invalid.',
  AUTOMATION_API_VERSION_UNSUPPORTED: 'This automation API version is not supported.',
  AUTOMATION_COMMAND_NOT_FOUND: 'This automation command is not available.',
  AUTOMATION_EXECUTION_NOT_FOUND: 'This automation execution is no longer available.',
  AUTOMATION_SOURCE_NOT_ALLOWED: 'This automation source cannot call the requested command.',
  AUTOMATION_CAPABILITY_DENIED: 'The automation execution has not been granted the required capability.',
  AUTOMATION_LIBRARY_NOT_BOUND: 'This automation execution must open and bind a library before calling this command.',
  AUTOMATION_LIBRARY_OPEN_FAILED: 'The created library could not be opened and bound to this automation execution.',
  AUTOMATION_CONCURRENCY_LIMIT_REACHED: 'This automation execution has reached its concurrent command limit.',
  AUTOMATION_EXECUTION_CANCELLED: 'This automation execution has been cancelled.',
  AUTOMATION_EXECUTION_TIMED_OUT: 'This automation execution timed out.',
  AUTOMATION_RESULT_INVALID: 'Serpent received an invalid result from the automation command.',
};

export const automationGatewayErrorSchema = z.strictObject({
  code: automationGatewayErrorCodeSchema,
  message: z.string().min(1).max(1_024),
}).superRefine((error, context) => {
  if (error.message !== AUTOMATION_GATEWAY_ERROR_MESSAGES[error.code]) {
    context.addIssue({ code: 'custom', path: ['message'], message: 'Automation Gateway error messages are fixed.' });
  }
});
export type AutomationGatewayError = z.infer<typeof automationGatewayErrorSchema>;

/** The only failure envelope allowed to cross the Desktop Script boundary. */
export const automationScriptHostErrorSchema = z.union([
  publicErrorSchema,
  automationGatewayErrorSchema,
]);
export type AutomationScriptHostError = PublicError | AutomationGatewayError;

export function createAutomationGatewayError(code: AutomationGatewayErrorCode): AutomationGatewayError {
  return automationGatewayErrorSchema.parse({
    code,
    message: AUTOMATION_GATEWAY_ERROR_MESSAGES[code],
  });
}

/**
 * A marked error used inside Main and the isolated Script Runtime. The
 * failure is already validated before construction and can therefore be
 * serialized without inspecting arbitrary Error objects.
 */
export class AutomationScriptHostCommandError extends Error {
  readonly failure: AutomationScriptHostError;

  constructor(failure: AutomationScriptHostError) {
    super(failure.message);
    this.name = 'AutomationScriptHostCommandError';
    this.failure = failure;
  }
}

export function toAutomationScriptHostFailure(error: unknown): AutomationScriptHostError {
  if (error instanceof AutomationScriptHostCommandError) return error.failure;
  return createPublicError('INTERNAL_ERROR');
}

export function automationScriptHostFailureFromError(error: unknown): AutomationScriptHostError | undefined {
  return error instanceof AutomationScriptHostCommandError ? error.failure : undefined;
}
