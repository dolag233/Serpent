import { z } from 'zod';

/**
 * Main → Renderer: an automation (MCP) command finished executing
 * (Serpent-fmbr). The renderer maps the structured result onto the SAME
 * human-facing toast a user gets for the equivalent manual operation —
 * there is deliberately no separate "MCP notification" system.
 *
 * Only successful non-read commands are emitted (filtered by the MCP server
 * against the command registry); the payload never carries file paths.
 */
export const commandCompletedPayloadSchema = z.strictObject({
  commandId: z.string().min(1),
  result: z.unknown().nullable(),
});

export type CommandCompletedPayload = z.infer<typeof commandCompletedPayloadSchema>;
