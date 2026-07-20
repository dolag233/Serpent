import { z } from 'zod';

import {
  DEFAULT_AI_ANALYSIS_SETTINGS,
  type AiAnalysisSettings,
} from '../../shared/ai-analysis-settings';

/**
 * The structured-output contract that AI models must conform to (F8).
 */
export const aiStructuredOutputSchema = z.strictObject({
  description: z
    .string()
    .optional()
    .describe('Natural-language description of the asset content.'),
  tags: z
    .array(z.string())
    .describe('Relevant keyword tags describing the asset.'),
  rating: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('Aesthetic score from 1 to 5.'),
});

export type AiStructuredOutput = z.infer<typeof aiStructuredOutputSchema>;

export const aiAnalysisResultSchema = aiStructuredOutputSchema.extend({
  modelVersion: z
    .string()
    .min(1)
    .describe('The vendor model version that produced this result.'),
});

export type AiAnalysisResult = z.infer<typeof aiAnalysisResultSchema>;

function stripNullValues(input: unknown): unknown {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      input as Record<string, unknown>,
    )) {
      if (value !== null) out[key] = value;
    }
    return out;
  }
  return input;
}

export function parseAiAnalysisResult(input: unknown): AiAnalysisResult {
  return aiAnalysisResultSchema.parse(stripNullValues(input));
}

export interface AiAnalysisRequest {
  filename: string;
  mime: string;
  contactSheetDescription?: string;
  imageBase64?: string;
  contactSheetBase64?: string;
  /** Prompt language line (may list multiple). */
  language: string;
  enabledFields: {
    description: boolean;
    tags: boolean;
    rating: boolean;
  };
  existingTagNames: string[];
  /** Defaults to DEFAULT_AI_ANALYSIS_SETTINGS when omitted (tests / stubs). */
  analysisSettings?: AiAnalysisSettings;
}

export function resolveAiAnalysisSettings(
  request: AiAnalysisRequest,
): AiAnalysisSettings {
  return request.analysisSettings ?? DEFAULT_AI_ANALYSIS_SETTINGS;
}
