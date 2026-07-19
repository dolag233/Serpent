import { z } from 'zod';

/**
 * The structured-output contract that AI models must conform to.
 * This is the JSON shape the vendor API is instructed to return.
 */
export const aiStructuredOutputSchema = z.strictObject({
  description: z
    .string()
    .optional()
    .describe('A detailed natural-language description of the asset content.'),
  tags: z
    .array(z.string())
    .describe('Relevant keyword tags describing the asset.'),
  structured_metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional structured metadata keyed by field name.'),
});

export type AiStructuredOutput = z.infer<typeof aiStructuredOutputSchema>;

/**
 * The validated result returned by a vendor adapter after a successful
 * analysis.  Wraps the model's structured output with the model version
 * reported by the vendor API.
 */
export const aiAnalysisResultSchema = aiStructuredOutputSchema.extend({
  modelVersion: z
    .string()
    .min(1)
    .describe('The vendor model version that produced this result.'),
});

export type AiAnalysisResult = z.infer<typeof aiAnalysisResultSchema>;

/**
 * Drop top-level keys whose value is `null`. Vendor wire schemas mark
 * optional fields (description / structured_metadata) as required-but-nullable,
 * so models emit `null` for inapplicable fields; stripping them keeps
 * explicit-null and absent equivalent before schema validation.
 */
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

/**
 * Parse and validate an AI analysis result.
 * Throws ZodError if the input does not conform to AiAnalysisResult.
 */
export function parseAiAnalysisResult(input: unknown): AiAnalysisResult {
  return aiAnalysisResultSchema.parse(stripNullValues(input));
}

/**
 * Vendor-agnostic request for AI asset analysis.
 * Carries all context the adapter needs to construct a prompt and images.
 */
export interface AiAnalysisRequest {
  /** The asset's display filename, for contextual prompting. */
  filename: string;

  /** The asset's MIME type. */
  mime: string;

  /** Optional description of contact-sheet contents (video assets). */
  contactSheetDescription?: string;

  /** Base64-encoded primary image (thumbnail for images, poster frame for video). */
  imageBase64?: string;

  /** Base64-encoded contact sheet (video assets only). */
  contactSheetBase64?: string;

  /** BCP-47 language tag for the desired response language. */
  language: string;

  /** Which fields the AI may populate. */
  enabledFields: {
    description: boolean;
    tags: boolean;
    structuredMetadata: boolean;
  };

  /**
   * Existing tag names in the library, used by the adapter to hint
   * tag reuse to the model.
   */
  existingTagNames: string[];
}
