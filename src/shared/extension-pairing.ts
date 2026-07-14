import { z } from 'zod';

export const extensionPairingRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('extension-pairing.get') }),
  z.strictObject({ type: z.literal('extension-pairing.rotate') }),
]);

export const extensionPairingResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }),
  z.strictObject({ ok: z.literal(false), message: z.string().min(1).max(240) }),
]);

export type ExtensionPairingRequest = z.infer<typeof extensionPairingRequestSchema>;
export type ExtensionPairingResult = z.infer<typeof extensionPairingResultSchema>;

export function parseExtensionPairingRequest(input: unknown): ExtensionPairingRequest {
  return extensionPairingRequestSchema.parse(input);
}

export function parseExtensionPairingResult(input: unknown): ExtensionPairingResult {
  return extensionPairingResultSchema.parse(input);
}

export interface SerpentExtensionPairingApi {
  getToken(): Promise<ExtensionPairingResult>;
  rotateToken(): Promise<ExtensionPairingResult>;
}
