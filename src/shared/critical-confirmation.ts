import { z } from 'zod';

export const criticalConfirmationPayloadSchema = z.strictObject({
  title: z.string().min(1).max(160),
  heading: z.string().min(1).max(200),
  message: z.string().min(1).max(500),
  detail: z.string().min(1).max(2_000),
  cancelLabel: z.string().min(1).max(80),
  confirmLabel: z.string().min(1).max(80),
});
export type CriticalConfirmationPayload = z.infer<typeof criticalConfirmationPayloadSchema>;

export const criticalConfirmationDecisionSchema = z.enum(['cancel', 'confirm']);
export type CriticalConfirmationDecision = z.infer<typeof criticalConfirmationDecisionSchema>;
