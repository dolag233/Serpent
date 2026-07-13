import { z } from 'zod';

import { aiSearchPlanSchema, type AiSearchPlan, type FilterClause } from '../shared/asset-types';
import type { PublicErrorReason } from '../shared/protocol/errors';

export type AiSearchProvider = 'openai' | 'gemini' | 'anthropic';

export class AiSearchPlannerError extends Error {
  constructor(
    readonly reason: Extract<PublicErrorReason,
      | 'AI_AUTH'
      | 'AI_PERMISSION'
      | 'AI_QUOTA'
      | 'AI_RATE_LIMIT'
      | 'AI_NETWORK'
      | 'AI_TIMEOUT'
      | 'AI_INVALID_RESPONSE'
      | 'AI_REFUSED'>,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AiSearchPlannerError';
  }
}

const boundedTerm = z.string().min(1).max(512).transform((value) => value.trim())
  .refine((value) => value.length > 0, 'Search terms cannot be blank.')
  .refine((value) => !/^(?:[A-Za-z]:[\\/]|[/\\]{1,2})/u.test(value), 'Absolute paths are not search-plan terms.');
const rawRangeSchema = z.strictObject({
  min: z.number().finite().nonnegative().nullable(),
  max: z.number().finite().nonnegative().nullable(),
}).refine((range) => range.min !== null || range.max !== null, 'A numeric range requires a bound.')
  .refine((range) => range.min === null || range.max === null || range.min <= range.max, 'Range bounds are reversed.');
const rawFilterSchema = z.strictObject({
  kind: z.enum(['categorical', 'numeric']),
  field: z.enum([
    'format', 'tag', 'rating', 'favorite', 'source_url', 'availability',
    'width', 'height', 'aspect_ratio', 'duration_ms',
  ]),
  values: z.array(boundedTerm).max(32),
  ranges: z.array(rawRangeSchema).max(32),
  exclude: z.boolean(),
}).superRefine((filter, context) => {
  const numeric = ['width', 'height', 'aspect_ratio', 'duration_ms'].includes(filter.field);
  if ((filter.kind === 'numeric') !== numeric) {
    context.addIssue({ code: 'custom', message: 'Filter kind does not match its field.' });
  }
  if (numeric && (filter.ranges.length === 0 || filter.values.length > 0)) {
    context.addIssue({ code: 'custom', message: 'Numeric filters require ranges and no values.' });
  }
  if (!numeric && filter.ranges.length > 0) {
    context.addIssue({ code: 'custom', message: 'Categorical filters cannot contain ranges.' });
  }
  if (!numeric && !['favorite', 'source_url'].includes(filter.field) && filter.values.length === 0) {
    context.addIssue({ code: 'custom', message: 'Categorical filters require values.' });
  }
});

const rawPlanSchema = z.strictObject({
  keywords: z.array(boundedTerm).max(16),
  synonyms: z.array(boundedTerm).max(16),
  exclusions: z.array(boundedTerm).max(16),
  filters: z.array(rawFilterSchema).max(16),
  sort: z.strictObject({
    field: z.enum(['name', 'modified_at', 'created_at', 'byte_size', 'duration', 'rating', 'color']),
    order: z.enum(['asc', 'desc']),
  }).nullable(),
});

const RANGE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    min: { type: ['number', 'null'], minimum: 0 },
    max: { type: ['number', 'null'], minimum: 0 },
  },
  required: ['min', 'max'],
} as const;

const FILTER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['categorical', 'numeric'] },
    field: {
      type: 'string',
      enum: [
        'format', 'tag', 'rating', 'favorite', 'source_url', 'availability',
        'width', 'height', 'aspect_ratio', 'duration_ms',
      ],
    },
    values: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 512 } },
    ranges: { type: 'array', maxItems: 32, items: RANGE_JSON_SCHEMA },
    exclude: { type: 'boolean' },
  },
  required: ['kind', 'field', 'values', 'ranges', 'exclude'],
} as const;

export const AI_SEARCH_PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    keywords: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 512 } },
    synonyms: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 512 } },
    exclusions: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 512 } },
    filters: { type: 'array', maxItems: 16, items: FILTER_JSON_SCHEMA },
    sort: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            field: { type: 'string', enum: ['name', 'modified_at', 'created_at', 'byte_size', 'duration', 'rating', 'color'] },
            order: { type: 'string', enum: ['asc', 'desc'] },
          },
          required: ['field', 'order'],
        },
        { type: 'null' },
      ],
    },
  },
  required: ['keywords', 'synonyms', 'exclusions', 'filters', 'sort'],
} as const;

// Gemini's `responseSchema` accepts the OpenAPI schema subset, where nullable
// values are expressed with `nullable: true` instead of JSON Schema type arrays.
const GEMINI_AI_SEARCH_PLAN_SCHEMA = {
  ...AI_SEARCH_PLAN_JSON_SCHEMA,
  properties: {
    ...AI_SEARCH_PLAN_JSON_SCHEMA.properties,
    filters: {
      type: 'array', maxItems: 16,
      items: {
        ...FILTER_JSON_SCHEMA,
        properties: {
          ...FILTER_JSON_SCHEMA.properties,
          ranges: {
            type: 'array', maxItems: 32,
            items: {
              type: 'object',
              properties: {
                min: { type: 'number', minimum: 0, nullable: true },
                max: { type: 'number', minimum: 0, nullable: true },
              },
              required: ['min', 'max'],
            },
          },
        },
      },
    },
    sort: {
      type: 'object',
      nullable: true,
      properties: {
        field: { type: 'string', enum: ['name', 'modified_at', 'created_at', 'byte_size', 'duration', 'rating', 'color'] },
        order: { type: 'string', enum: ['asc', 'desc'] },
      },
      required: ['field', 'order'],
    },
  },
} as const;

const SYSTEM_PROMPT = `You translate a user's natural-language request into a Serpent digital-asset search plan.
Return only the required structured object. Never output SQL, code, filesystem paths, IDs, or new operators.
Use concise literal keywords. Put related alternative terms in synonyms and unwanted concepts in exclusions.
Allowed categorical filters: format, tag, rating (0-5 strings), favorite/source_url (empty values means presence), availability (available or missing).
Allowed numeric filters: width/height in pixels, aspect_ratio as a positive ratio, duration_ms in milliseconds. Numeric filters use ranges; categorical filters use values. Unused arrays must be empty.
Only add a sort when the user explicitly asks for ordering. The ordinary parameterized Serpent search engine will execute the plan.`;

type Fetch = typeof globalThis.fetch;

export async function planAiSearch(input: {
  provider: AiSearchProvider;
  model: string;
  apiKey: string;
  naturalQuery: string;
  fetchFn?: Fetch;
  timeoutMs?: number;
}): Promise<AiSearchPlan> {
  const fetchFn = input.fetchFn ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
  try {
    const response = await fetchFn(...providerRequest(input, controller.signal));
    if (!response.ok) throw await httpFailure(response);
    const body = await readJson(response);
    const output = extractProviderOutput(input.provider, body);
    return normalizePlan(output);
  } catch (error) {
    if (error instanceof AiSearchPlannerError) throw error;
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new AiSearchPlannerError('AI_TIMEOUT', 'AI search planning timed out.', { cause: error });
    }
    throw new AiSearchPlannerError('AI_NETWORK', 'Could not reach the AI provider.', { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function providerRequest(
  input: { provider: AiSearchProvider; model: string; apiKey: string; naturalQuery: string },
  signal: AbortSignal,
): Parameters<Fetch> {
  if (input.provider === 'openai') {
    return ['https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        temperature: 0,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: input.naturalQuery }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'serpent_search_plan', strict: true, schema: AI_SEARCH_PLAN_JSON_SCHEMA },
        },
      }),
    }];
  }
  if (input.provider === 'gemini') {
    return [`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, {
      method: 'POST', signal,
      headers: { 'x-goog-api-key': input.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: input.naturalQuery }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_AI_SEARCH_PLAN_SCHEMA,
        },
      }),
    }];
  }
  return ['https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 1_024,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: input.naturalQuery }],
      tools: [{
        name: 'serpent_prepare_search',
        description: 'Prepare a constrained Serpent search plan.',
        input_schema: AI_SEARCH_PLAN_JSON_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'serpent_prepare_search' },
    }),
  }];
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new AiSearchPlannerError('AI_INVALID_RESPONSE', 'The provider returned unreadable JSON.', { cause: error });
  }
}

function extractProviderOutput(provider: AiSearchProvider, body: unknown): unknown {
  const record = asRecord(body);
  if (provider === 'openai') {
    const message = asRecord(asRecord(asArray(record.choices)[0]).message);
    if (typeof message.refusal === 'string' && message.refusal.trim()) {
      throw new AiSearchPlannerError('AI_REFUSED', 'The provider refused to prepare this search.');
    }
    return parseEmbeddedJson(message.content);
  }
  if (provider === 'gemini') {
    const feedback = asRecord(record.promptFeedback);
    if (typeof feedback.blockReason === 'string' && feedback.blockReason) {
      throw new AiSearchPlannerError('AI_REFUSED', 'The provider blocked this search request.');
    }
    const candidate = asRecord(asArray(record.candidates)[0]);
    if (['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(String(candidate.finishReason))) {
      throw new AiSearchPlannerError('AI_REFUSED', 'The provider refused to prepare this search.');
    }
    const parts = asArray(asRecord(candidate.content).parts);
    const text = parts.map((part) => asRecord(part).text).find((value): value is string => typeof value === 'string');
    return parseEmbeddedJson(text);
  }
  const content = asArray(record.content);
  const toolUse = content.map(asRecord).find((item) => item.type === 'tool_use' && item.name === 'serpent_prepare_search');
  if (!toolUse) {
    const refused = content.map(asRecord).some((item) => item.type === 'text');
    throw new AiSearchPlannerError(refused ? 'AI_REFUSED' : 'AI_INVALID_RESPONSE',
      refused ? 'The provider refused to prepare this search.' : 'The provider did not return the search tool result.');
  }
  return toolUse.input;
}

function parseEmbeddedJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.length > 65_536) {
    throw new AiSearchPlannerError('AI_INVALID_RESPONSE', 'The provider did not return a bounded structured result.');
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new AiSearchPlannerError('AI_INVALID_RESPONSE', 'The provider returned invalid search-plan JSON.', { cause: error });
  }
}

function normalizePlan(input: unknown): AiSearchPlan {
  let parsed: z.infer<typeof rawPlanSchema>;
  try {
    parsed = rawPlanSchema.parse(input);
  } catch (error) {
    throw new AiSearchPlannerError('AI_INVALID_RESPONSE', 'The provider returned an unsupported search plan.', { cause: error });
  }
  const filters: FilterClause[] = parsed.filters.map((filter) => {
    if (filter.kind === 'numeric') {
      return {
        field: filter.field as 'width' | 'height' | 'aspect_ratio' | 'duration_ms',
        ranges: filter.ranges.map((range) => ({
          ...(range.min === null ? {} : { min: range.min }),
          ...(range.max === null ? {} : { max: range.max }),
        })),
        exclude: filter.exclude,
      };
    }
    return {
      field: filter.field as 'format' | 'tag' | 'rating' | 'favorite' | 'source_url' | 'availability',
      values: unique(filter.values),
      exclude: filter.exclude,
    };
  });
  try {
    return aiSearchPlanSchema.parse({
      keywords: unique(parsed.keywords),
      synonyms: unique(parsed.synonyms),
      exclusions: unique(parsed.exclusions),
      filters,
      ...(parsed.sort === null ? {} : { sort: parsed.sort }),
    });
  } catch (error) {
    throw new AiSearchPlannerError('AI_INVALID_RESPONSE', 'The provider returned an invalid search plan.', { cause: error });
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function httpFailure(response: Response): Promise<AiSearchPlannerError> {
  const status = response.status;
  const body = await response.text().catch(() => '');
  let reason: AiSearchPlannerError['reason'];
  if (status === 401) reason = 'AI_AUTH';
  else if (status === 403) reason = 'AI_PERMISSION';
  else if (status === 429 && /quota|billing|exhausted/i.test(body)) reason = 'AI_QUOTA';
  else if (status === 429) reason = 'AI_RATE_LIMIT';
  else if (status >= 500) reason = 'AI_NETWORK';
  else reason = 'AI_INVALID_RESPONSE';
  return new AiSearchPlannerError(reason, `AI search provider failed with HTTP ${status}.`);
}

export function aiSearchFailureReason(error: unknown): PublicErrorReason {
  return error instanceof AiSearchPlannerError ? error.reason : 'AI_INVALID_RESPONSE';
}
