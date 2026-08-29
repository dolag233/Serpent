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
  return aiAnalysisResultSchema.parse(normalizeAiStructuredInput(input));
}

/**
 * Prefer plain model text that embeds a JSON object (optionally fenced).
 * Avoids requiring vendor-native json_schema / tool_use when midstream
 * proxies only return text.
 */
export function parseAiAnalysisResultFromModelText(
  text: string,
  modelVersion: string,
): AiAnalysisResult {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('Model text did not contain a JSON object.');
    }
    parsed = JSON.parse(unfenced.slice(start, end + 1));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model JSON was not an object.');
  }
  return parseAiAnalysisResult({
    ...(parsed as Record<string, unknown>),
    modelVersion,
  });
}

const MAX_AI_TAG_CHARS = 200;
const MAX_AI_DESCRIPTION_CHARS = 4_000;

/**
 * Enforce user-facing AI settings after parsing provider output. Prompt text
 * is advisory: a provider, relay, or asset-controlled filename can still
 * return valid JSON that violates those instructions, so policy belongs at
 * the write boundary as well.
 */
export function applyAiOutputPolicy(
  result: AiAnalysisResult,
  input: {
    settings: AiAnalysisSettings;
    existingTagNames: readonly string[];
    language: string;
  },
): AiAnalysisResult {
  const existingByKey = new Map(
    input.existingTagNames
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => [name.toLocaleLowerCase(), name] as const),
  );
  const seenTags = new Set<string>();
  const tags: string[] = [];
  for (const rawTag of result.tags) {
    const trimmed = rawTag.trim();
    if (!trimmed || trimmed.length > MAX_AI_TAG_CHARS) continue;
    const key = trimmed.toLocaleLowerCase();
    const canonical = existingByKey.get(key);
    if (input.settings.forceExistingTags && canonical === undefined) continue;
    if (seenTags.has(key)) continue;
    seenTags.add(key);
    tags.push(canonical ?? trimmed);
    if (tags.length >= input.settings.maxTags) break;
  }

  let description = result.description?.trim();
  if (description) {
    description = description.slice(0, MAX_AI_DESCRIPTION_CHARS);
    const language = input.language.toLocaleLowerCase();
    if (language.includes("zh") || language.includes("chinese")) {
      description = description.slice(0, input.settings.maxDescriptionCharsZh);
    }
    if (language.includes("en") || language.includes("english")) {
      description = description
        .split(/\s+/u)
        .slice(0, input.settings.maxDescriptionWordsEn)
        .join(" ");
    }
    if (!description) description = undefined;
  }

  return {
    ...result,
    ...(description === undefined ? { description: undefined } : { description }),
    tags,
  };
}

/** Coerce common model drift before Zod (tags as string, nulls, etc.). */
function normalizeAiStructuredInput(input: unknown): unknown {
  const stripped = stripNullValues(input);
  if (!stripped || typeof stripped !== 'object' || Array.isArray(stripped)) {
    return stripped;
  }
  const row = { ...(stripped as Record<string, unknown>) };
  if (typeof row.tags === 'string') {
    row.tags = row.tags
      .split(/[,，;；|]/u)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (typeof row.rating === 'string' && /^\d+$/.test(row.rating.trim())) {
    row.rating = Number(row.rating.trim());
  }
  return row;
}

export interface AiAnalysisRequest {
  /** UI display name (basename of library-relative path). */
  displayName: string;
  filename: string;
  mime: string;
  /** Visual presentation kind — drives the system prompt explanation. */
  mediaType?: 'image' | 'video' | 'model';
  contactSheetDescription?: string;
  imageBase64?: string;
  contactSheetBase64?: string;
  /** MIME of the contact-sheet derivative (normally image/jpeg). */
  contactSheetMime?: string;
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

/** Shared user-message context for all vendor adapters. */
export function buildAiAnalysisUserTextLines(
  request: AiAnalysisRequest,
): string[] {
  const lines = [
    'Asset metadata:',
    `- Name: ${request.displayName}`,
    `Filename: ${request.filename}`,
  ];
  if (request.contactSheetDescription) {
    lines.push(`Contact sheet description: ${request.contactSheetDescription}`);
  }
  if (request.contactSheetBase64) {
    lines.push(
      request.imageBase64
        ? 'The first image is the poster frame and the second is a contact sheet of key frames; every frame carries its timestamp (HH:MM:SS.mmm) at the bottom right.'
        : 'The supplied image is a contact sheet of key video frames; every frame carries its timestamp (HH:MM:SS.mmm) at the bottom right.',
    );
  }
  return lines;
}
