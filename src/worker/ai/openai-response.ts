import {
  aiTagsSchemaDescription,
} from '../../shared/ai-analysis-settings';
import {
  parseAiAnalysisResult,
  parseAiAnalysisResultFromModelText,
} from './protocol';
import type { AiAnalysisResult } from './protocol';
import { VendorAdapterError } from './vendor-adapter';
import type {
  VendorAdapterErrorDetails,
  VendorAdapterErrorKind,
} from './vendor-adapter';

export type OpenAiWireFormat = 'openai_chat' | 'openai_responses';

export type OpenAiStructuredOutputMode = 'json_schema' | 'json_object' | 'text';

export const OPENAI_STRUCTURED_OUTPUT_MODES: readonly OpenAiStructuredOutputMode[] = [
  'json_schema',
  'json_object',
  'text',
];

export interface OpenAiProviderError {
  code?: string;
  type?: string;
  param?: string;
  message?: string;
  requestId?: string;
}

export interface OpenAiHttpErrorClassification {
  kind: VendorAdapterErrorKind;
  providerError?: OpenAiProviderError;
  formatRejected: boolean;
  schemaShapeRejected: boolean;
  suggestedModes?: OpenAiStructuredOutputMode[];
}

type ResponseMetadata = {
  modelVersion: string;
  source: string;
  finishReason?: string;
};

export type OpenAiNormalizedResponse =
  | ({ kind: 'text'; text: string } & ResponseMetadata)
  | ({ kind: 'json_value'; value: unknown } & ResponseMetadata)
  | ({ kind: 'tool_call'; name?: string; arguments?: unknown } & ResponseMetadata)
  | ({ kind: 'refusal'; text?: string } & ResponseMetadata)
  | ({ kind: 'reasoning_only'; text: string } & ResponseMetadata)
  | ({ kind: 'empty' } & ResponseMetadata)
  | ({ kind: 'incomplete'; reason?: string } & ResponseMetadata)
  | ({ kind: 'failed'; message?: string; providerError?: OpenAiProviderError } & ResponseMetadata)
  | ({ kind: 'provider_error'; error: OpenAiProviderError } & ResponseMetadata);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function responseMetadata(
  body: Record<string, unknown>,
  fallbackModel: string,
  source: string,
  finishReason?: unknown,
): ResponseMetadata {
  const modelVersion = nonEmptyString(body.model) ?? fallbackModel;
  return {
    modelVersion,
    source,
    ...(nonEmptyString(finishReason) ? { finishReason: finishReason as string } : {}),
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const result = nonEmptyString(value);
    if (result) return result;
  }
  return undefined;
}

function providerErrorFromBody(body: unknown): OpenAiProviderError | undefined {
  if (!isRecord(body)) return undefined;
  const nested = isRecord(body.error) ? body.error : undefined;
  const source = nested ?? body;
  const message = firstString(
    source.message,
    typeof body.error === 'string' ? body.error : undefined,
    body.message,
  );
  const code = firstString(source.code, body.code);
  const type = firstString(source.type, body.type);
  const param = firstString(source.param, body.param);
  const requestId = firstString(
    body.request_id,
    body.requestId,
    source.request_id,
    source.requestId,
  );
  if (!message && !code && !type && !param && !requestId) return undefined;
  return {
    ...(code ? { code } : {}),
    ...(type ? { type } : {}),
    ...(param ? { param } : {}),
    ...(message ? { message } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

function providerErrorSearchText(
  bodyText: string,
  providerError: OpenAiProviderError | undefined,
): string {
  return [
    bodyText,
    providerError?.code,
    providerError?.type,
    providerError?.param,
    providerError?.message,
  ].filter(Boolean).join(' ');
}

function outputFormatMentioned(value: string): boolean {
  return /\b(?:response[_ -]?format|text\.format|structured[_ -]?outputs?|output[_ -]?format|json[_ -]?schema|json[_ -]?object)\b/iu.test(value);
}

function explicitFormatRejection(value: string): boolean {
  return /\b(?:unsupported|not\s+supported|does\s+not\s+support|not\s+available|unrecognised?|must\s+be|only\s+(?:accepts?|allows?|supports?)|expected\s+(?:one|a)\s+of)\b/iu.test(value);
}

function schemaShapeRejection(value: string, attemptedMode?: OpenAiStructuredOutputMode): boolean {
  return attemptedMode === 'json_schema'
    && /['"]?type['"]?\s+(?:must|should)\s+be\s+(?:a\s+)?string\b/iu.test(value);
}

function schemaEnvelopeValidationRejection(
  value: string,
  attemptedMode?: OpenAiStructuredOutputMode,
): boolean {
  if (attemptedMode !== 'json_schema') return false;

  // Some OpenAI-compatible providers report JSON Schema validation errors as
  // a provider-side `None`/type failure instead of saying that json_schema is
  // unsupported. Restrict this escape hatch to the exact nested schema path
  // and a validation-error phrase so ordinary parameter errors do not fall
  // through to a different request format.
  const schemaPathMentioned =
    /response[_ -]?format[.\s_-]+json[_ -]?schema[.\s_-]+schema\b/iu.test(value);
  const validationFailureMentioned =
    /\b(?:format\s+error|not\s+of\s+type|must\s+be\s+(?:an?\s+)?(?:object|boolean)|expected\b[^.\n]{0,80}\b(?:object|boolean)\b)\b/iu.test(value);
  return schemaPathMentioned && validationFailureMentioned;
}

function parseProviderErrorBody(bodyText: string): OpenAiProviderError | undefined {
  try {
    return providerErrorFromBody(JSON.parse(bodyText) as unknown);
  } catch {
    return undefined;
  }
}

function modesMentioned(
  value: string,
  attemptedMode?: OpenAiStructuredOutputMode,
): OpenAiStructuredOutputMode[] {
  const mentioned = new Set<OpenAiStructuredOutputMode>();
  for (const mode of OPENAI_STRUCTURED_OUTPUT_MODES) {
    if (new RegExp(`\\b${mode}\\b`, 'iu').test(value) && mode !== attemptedMode) {
      mentioned.add(mode);
    }
  }
  return OPENAI_STRUCTURED_OUTPUT_MODES.filter((mode) => mentioned.has(mode));
}

/**
 * Recognize only an explicit output-format compatibility error. Generic
 * `invalid`/400 responses are deliberately not enough: they may describe a
 * model, image, authentication scope, prompt, or quota problem.
 */
export function isStructuredOutputFormatRejection(
  body: string,
  attemptedMode?: OpenAiStructuredOutputMode,
): boolean {
  const providerError = parseProviderErrorBody(body);
  const searchable = providerErrorSearchText(body, providerError);
  return (
    (outputFormatMentioned(searchable) && explicitFormatRejection(searchable))
    || schemaShapeRejection(searchable, attemptedMode)
    || schemaEnvelopeValidationRejection(searchable, attemptedMode)
  );
}

export function classifyOpenAiHttpError(
  status: number,
  bodyText: string,
  attemptedMode?: OpenAiStructuredOutputMode,
): OpenAiHttpErrorClassification {
  const providerError = parseProviderErrorBody(bodyText);
  const searchable = providerErrorSearchText(bodyText, providerError);
  const schemaShapeRejected =
    schemaShapeRejection(searchable, attemptedMode)
    || schemaEnvelopeValidationRejection(searchable, attemptedMode);
  const formatRejected =
    (status === 400 || status === 422)
    && isStructuredOutputFormatRejection(bodyText, attemptedMode);
  const mentionedModes = formatRejected
    ? modesMentioned(searchable, attemptedMode)
    : [];

  let kind: VendorAdapterErrorKind;
  if (status === 401) {
    kind = 'auth';
  } else if (status === 403) {
    kind = 'permission';
  } else if (status === 429) {
    const lower = searchable.toLowerCase();
    kind = lower.includes('quota') || lower.includes('insufficient')
      ? 'quota'
      : 'rate_limit';
  } else if (status >= 500 || status === 408) {
    kind = 'network';
  } else {
    kind = 'invalid_response';
  }

  let suggestedModes: OpenAiStructuredOutputMode[] | undefined;
  if (formatRejected) {
    if (mentionedModes.length > 0) {
      suggestedModes = mentionedModes;
    } else if (schemaShapeRejected && attemptedMode === 'json_schema') {
      // LM Studio's schema parser can reject a valid JSON Schema union before
      // the request reaches generation. Its portable escape hatch is text.
      suggestedModes = ['text'];
    } else if (attemptedMode === 'json_schema') {
      // A legacy relay that only says “unsupported schema” may still support
      // json_object. Try it only after the provider explicitly rejected the
      // schema envelope; it is never the default probe mode.
      suggestedModes = ['json_object', 'text'];
    } else {
      suggestedModes = ['text'];
    }
  }

  return {
    kind,
    ...(providerError ? { providerError } : {}),
    formatRejected,
    schemaShapeRejected,
    ...(suggestedModes ? { suggestedModes } : {}),
  };
}

function providerDetails(
  error: OpenAiProviderError | undefined,
  extra: Partial<VendorAdapterErrorDetails> = {},
): VendorAdapterErrorDetails {
  return {
    ...(error?.code ? { providerCode: error.code } : {}),
    ...(error?.type ? { providerType: error.type } : {}),
    ...(error?.param ? { providerParam: error.param } : {}),
    ...(error?.message ? { providerMessage: error.message } : {}),
    ...(error?.requestId ? { requestId: error.requestId } : {}),
    ...extra,
  };
}

export async function mapOpenAiHttpError(
  response: Response,
  attemptedMode?: OpenAiStructuredOutputMode,
): Promise<VendorAdapterError> {
  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch {
    // The HTTP status is still useful when a proxy closes the response body.
  }
  const classification = classifyOpenAiHttpError(
    response.status,
    bodyText,
    attemptedMode,
  );
  return new VendorAdapterError(
    classification.kind,
    `AI service returned HTTP ${response.status}`,
    {
      details: providerDetails(classification.providerError, {
        httpStatus: response.status,
        formatRejected: classification.formatRejected,
      }),
    },
  );
}

export function buildOpenAiStructuredResponseFormat(
  mode: Exclude<OpenAiStructuredOutputMode, 'text'>,
  language: string,
): Record<string, unknown> {
  if (mode === 'json_object') return { type: 'json_object' };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'serpent_asset_analysis',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: `Description of the asset content in ${language}, or null if skipped.`,
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: aiTagsSchemaDescription(language),
          },
          rating: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            description: 'Aesthetic score from 1 to 5, or null if unknown.',
          },
        },
        required: ['description', 'tags', 'rating'],
      },
    },
  };
}

export function buildOpenAiResponsesTextFormat(
  mode: Exclude<OpenAiStructuredOutputMode, 'text'>,
  language: string,
): Record<string, unknown> {
  if (mode === 'json_object') return { type: 'json_object' };
  const responseFormat = buildOpenAiStructuredResponseFormat(mode, language);
  const schema = responseFormat.json_schema;
  if (!isRecord(schema)) {
    throw new Error('OpenAI JSON schema response format was not constructed.');
  }
  return {
    type: 'json_schema',
    ...schema,
  };
}

function parseToolArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function normalizeToolCall(
  value: unknown,
  metadata: ResponseMetadata,
): OpenAiNormalizedResponse | undefined {
  if (!isRecord(value)) return undefined;
  const fn = isRecord(value.function) ? value.function : undefined;
  return {
    kind: 'tool_call',
    ...(firstString(fn?.name, value.name) ? { name: firstString(fn?.name, value.name) } : {}),
    ...(fn && 'arguments' in fn
      ? { arguments: parseToolArguments(fn.arguments) }
      : 'arguments' in value
        ? { arguments: parseToolArguments(value.arguments) }
        : {}),
    ...metadata,
  };
}

function normalizeToolCalls(
  value: unknown,
  metadata: ResponseMetadata,
): OpenAiNormalizedResponse | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return normalizeToolCall(value[0], metadata);
}

function normalizeContent(
  value: unknown,
  metadata: ResponseMetadata,
): OpenAiNormalizedResponse | undefined {
  if (typeof value === 'string') {
    return value.trim()
      ? { kind: 'text', text: value, ...metadata }
      : undefined;
  }
  if (Array.isArray(value)) {
    let refusal: string | undefined;
    let text = '';
    for (const part of value) {
      if (!isRecord(part)) continue;
      if (part.type === 'refusal') {
        refusal = firstString(part.refusal, part.text) ?? refusal;
      } else if (
        part.type === 'text'
        || part.type === 'output_text'
        || part.type === undefined
      ) {
        text += typeof part.text === 'string' ? part.text : '';
      }
    }
    if (text.trim()) return { kind: 'text', text, ...metadata };
    if (refusal) return { kind: 'refusal', text: refusal, ...metadata };
    return undefined;
  }
  if (isRecord(value)) {
    if (value.type === 'refusal') {
      return { kind: 'refusal', text: firstString(value.refusal, value.text), ...metadata };
    }
    if (
      (value.type === 'text' || value.type === 'output_text')
      && typeof value.text === 'string'
    ) {
      return value.text.trim()
        ? { kind: 'text', text: value.text, ...metadata }
        : undefined;
    }
    // A direct object in message.content is not standard Chat Completions,
    // but several local relays emit it. It still goes through Serpent's Zod
    // domain parser before it can be written.
    if (value.type === undefined) return { kind: 'json_value', value, ...metadata };
  }
  return undefined;
}

function reasoningText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .filter(isRecord)
    .map((part) => firstString(part.text, part.summary, part.content) ?? '')
    .filter(Boolean)
    .join('\n');
}

function normalizedProviderError(
  body: Record<string, unknown>,
  metadata: ResponseMetadata,
): OpenAiNormalizedResponse | undefined {
  const error = providerErrorFromBody(body);
  if (!error) return undefined;
  return { kind: 'provider_error', error, ...metadata };
}

export function normalizeOpenAiChatResponse(
  json: unknown,
  fallbackModel: string,
): OpenAiNormalizedResponse {
  if (!isRecord(json)) {
    return {
      kind: 'empty',
      modelVersion: fallbackModel,
      source: 'chat.invalid-envelope',
    };
  }
  const body = json;
  const baseMetadata = responseMetadata(body, fallbackModel, 'chat');
  const providerError = normalizedProviderError(body, baseMetadata);
  if (providerError) return providerError;

  if (!Array.isArray(body.choices) || body.choices.length === 0) {
    return { kind: 'empty', ...baseMetadata };
  }

  let firstFinishReason: string | undefined;
  for (const choiceValue of body.choices) {
    if (!isRecord(choiceValue)) continue;
    const finishReason = nonEmptyString(choiceValue.finish_reason);
    firstFinishReason ??= finishReason;
    const metadata = responseMetadata(body, fallbackModel, 'chat.choice', finishReason);
    const message = isRecord(choiceValue.message) ? choiceValue.message : undefined;
    if (!message) {
      const legacyText = normalizeContent(choiceValue.text, metadata);
      if (legacyText) return legacyText;
      continue;
    }

    const refusal = firstString(message.refusal);
    if (refusal) return { kind: 'refusal', text: refusal, ...metadata };

    const toolCall = normalizeToolCalls(message.tool_calls, metadata);
    if (toolCall) return toolCall;

    const content = normalizeContent(message.content, metadata);
    if (content) return content;

    const reasoning = reasoningText(message.reasoning_content ?? message.reasoning);
    if (reasoning.trim()) {
      return { kind: 'reasoning_only', text: reasoning, ...metadata };
    }
  }

  if (firstFinishReason === 'length' || firstFinishReason === 'max_tokens') {
    return {
      kind: 'incomplete',
      reason: firstFinishReason,
      ...baseMetadata,
    };
  }
  return {
    kind: 'empty',
    ...(firstFinishReason ? { finishReason: firstFinishReason } : {}),
    ...baseMetadata,
  };
}

export function normalizeOpenAiResponsesResponse(
  json: unknown,
  fallbackModel: string,
): OpenAiNormalizedResponse {
  if (!isRecord(json)) {
    return {
      kind: 'empty',
      modelVersion: fallbackModel,
      source: 'responses.invalid-envelope',
    };
  }
  const body = json;
  const baseMetadata = responseMetadata(body, fallbackModel, 'responses');
  const status = nonEmptyString(body.status);
  if (status === 'failed') {
    const providerError = providerErrorFromBody(body);
    return {
      kind: 'failed',
      message: firstString(
        providerError?.message,
        isRecord(body.error) ? body.error.message : undefined,
      ),
      ...(providerError ? { providerError } : {}),
      ...baseMetadata,
    };
  }
  if (status === 'incomplete') {
    const details = isRecord(body.incomplete_details) ? body.incomplete_details : undefined;
    return {
      kind: 'incomplete',
      reason: firstString(details?.reason),
      ...baseMetadata,
    };
  }

  const providerError = normalizedProviderError(body, baseMetadata);
  if (providerError) return providerError;

  if (typeof body.output_text === 'string' && body.output_text.trim()) {
    return { kind: 'text', text: body.output_text, ...baseMetadata };
  }

  let toolCall: OpenAiNormalizedResponse | undefined;
  let reasoningOnly: OpenAiNormalizedResponse | undefined;
  if (Array.isArray(body.output)) {
    for (const item of body.output) {
      if (!isRecord(item)) continue;
      const metadata = responseMetadata(
        body,
        fallbackModel,
        'responses.output',
        item.finish_reason,
      );
      if (item.type === 'function_call' || item.type === 'tool_call') {
        toolCall ??= normalizeToolCall(item, metadata);
        continue;
      }
      if (item.type === 'reasoning') {
        const reasoning = reasoningText(item.summary ?? item.content);
        if (reasoning.trim()) {
          reasoningOnly ??= { kind: 'reasoning_only', text: reasoning, ...metadata };
        }
        continue;
      }
      if (item.type !== 'message') continue;
      const content = normalizeContent(item.content, metadata);
      if (content) return content;
      const reasoning = reasoningText(item.reasoning_content ?? item.reasoning);
      if (reasoning.trim()) {
        reasoningOnly ??= { kind: 'reasoning_only', text: reasoning, ...metadata };
      }
    }
  }
  if (toolCall) return toolCall;
  if (reasoningOnly) return reasoningOnly;

  // A few nominal Responses relays return a Chat-shaped body. Keep this
  // compatibility path explicit and still use the Chat normalizer.
  if (Array.isArray(body.choices)) {
    return normalizeOpenAiChatResponse(body, fallbackModel);
  }
  if (isRecord(body.output) && Array.isArray(body.output.choices)) {
    return normalizeOpenAiChatResponse(
      { model: body.model, choices: body.output.choices },
      fallbackModel,
    );
  }

  return { kind: 'empty', ...baseMetadata };
}

function responseError(
  response: OpenAiNormalizedResponse,
  cause?: unknown,
): VendorAdapterError {
  const details: VendorAdapterErrorDetails = {
    responseKind: response.kind,
    ...(response.kind === 'empty' || response.kind === 'reasoning_only'
      || response.kind === 'text' || response.kind === 'json_value'
      || response.kind === 'incomplete'
      ? { canRetryWithoutStructuredOutput: true }
      : {}),
  };
  switch (response.kind) {
    case 'provider_error':
      return new VendorAdapterError(
        'invalid_response',
        'The AI service returned a provider error envelope.',
        {
          cause,
          details: providerDetails(response.error, details),
        },
      );
    case 'refusal':
      return new VendorAdapterError(
        'invalid_response',
        'The AI service refused to return an analysis.',
        { cause, details: { ...details, canRetryWithoutStructuredOutput: false } },
      );
    case 'tool_call':
      return new VendorAdapterError(
        'invalid_response',
        'The AI service returned a tool call instead of an analysis.',
        { cause, details: { ...details, canRetryWithoutStructuredOutput: false } },
      );
    case 'reasoning_only':
      return new VendorAdapterError(
        'invalid_response',
        'The AI service returned reasoning without a final analysis.',
        { cause, retryable: true, details },
      );
    case 'empty':
      return new VendorAdapterError(
        'invalid_response',
        'The AI service returned no completion content.',
        { cause, retryable: true, details },
      );
    case 'incomplete':
      return new VendorAdapterError(
        'invalid_response',
        'The AI service returned an incomplete analysis.',
        { cause, details: { ...details, canRetryWithoutStructuredOutput: false } },
      );
    case 'failed':
      return new VendorAdapterError(
        'invalid_response',
        'The AI service reported a failed response.',
        {
          cause,
          details: providerDetails(response.providerError, {
            ...details,
            canRetryWithoutStructuredOutput: false,
          }),
        },
      );
    case 'text':
    case 'json_value':
      return new VendorAdapterError(
        'invalid_response',
        'The AI response did not match the required schema.',
        { cause, retryable: true, details },
      );
  }
}

export function parseOpenAiAnalysisResponse(
  response: OpenAiNormalizedResponse,
): AiAnalysisResult {
  try {
    if (response.kind === 'text') {
      return parseAiAnalysisResultFromModelText(response.text, response.modelVersion);
    }
    if (response.kind === 'json_value') {
      if (!isRecord(response.value)) throw new Error('Direct JSON result was not an object.');
      return parseAiAnalysisResult({
        ...response.value,
        modelVersion: response.modelVersion,
      });
    }
  } catch (error: unknown) {
    throw responseError(response, error);
  }
  throw responseError(response);
}

export function canRetryOpenAiResponseWithoutStructuredOutput(
  error: unknown,
): error is VendorAdapterError {
  return error instanceof VendorAdapterError
    && error.details?.canRetryWithoutStructuredOutput === true;
}
