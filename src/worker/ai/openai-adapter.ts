import { createHash } from 'node:crypto';

import { buildAiAnalysisSystemPrompt } from '../../shared/ai-analysis-settings';
import {
  resolveOpenAiChatCompletionsUrl,
  resolveOpenAiResponsesUrl,
} from '../../shared/ai-endpoints';
import {
  buildAiAnalysisUserTextLines,
  resolveAiAnalysisSettings,
} from './protocol';
import type { AiAnalysisRequest, AiAnalysisResult } from './protocol';
import {
  buildOpenAiResponsesTextFormat,
  buildOpenAiStructuredResponseFormat,
  canRetryOpenAiResponseWithoutStructuredOutput,
  classifyOpenAiHttpError,
  mapOpenAiHttpError,
  normalizeOpenAiChatResponse,
  normalizeOpenAiResponsesResponse,
  parseOpenAiAnalysisResponse,
  OPENAI_STRUCTURED_OUTPUT_MODES,
} from './openai-response';
import type {
  OpenAiStructuredOutputMode,
  OpenAiWireFormat,
} from './openai-response';
import { isAiAbortOrTimeoutError, VendorAdapterError } from './vendor-adapter';
import type { VendorAdapter, VendorId } from './vendor-adapter';

export type { OpenAiStructuredOutputMode, OpenAiWireFormat } from './openai-response';
export {
  buildOpenAiStructuredResponseFormat,
  isStructuredOutputFormatRejection,
} from './openai-response';

/**
 * Keep a portable JSON contract in the prompt even when the endpoint accepts
 * a structured-output envelope. This is the fallback for relays that only
 * support ordinary text responses.
 */
function buildJsonOnlySuffix(language: string): string {
  return (
    `\nReturn ONLY one JSON object (no markdown fences) with keys ` +
    `description (string|null), tags (string[]), rating (1-5|null). ` +
    `Write description and tags in ${language}.`
  );
}

// Adapter instances are intentionally short lived (one analysis request), so
// this process-wide capability cache avoids paying a failed structured-output
// request for every asset on a compatibility relay that only returns text.
const structuredOutputModeByEndpoint = new Map<
  string,
  OpenAiStructuredOutputMode
>();
// Adapter instances are constructed per asset. A first batch must not send
// the same capability probe once per asset; followers use the portable text
// body immediately while the leader negotiates the richer envelope. The
// promise lets a follower recover when that text-only request is rejected by
// a provider that requires a structured envelope.
type StructuredOutputNegotiationResult =
  OpenAiStructuredOutputMode | undefined;
type StructuredOutputNegotiationInFlight = {
  promise: Promise<StructuredOutputNegotiationResult>;
  resolve: (mode: StructuredOutputNegotiationResult) => void;
};
const structuredOutputNegotiationInFlight = new Map<
  string,
  StructuredOutputNegotiationInFlight
>();
function beginStructuredOutputNegotiation(capabilityKey: string): {
  modes: OpenAiStructuredOutputMode[];
  ownsProbe: boolean;
  cachedMode?: OpenAiStructuredOutputMode;
  probeResult?: Promise<StructuredOutputNegotiationResult>;
} {
  const cachedMode = structuredOutputModeByEndpoint.get(capabilityKey);
  if (cachedMode) {
    return {
      modes: [
        cachedMode,
        ...DEFAULT_STRUCTURED_OUTPUT_MODES.filter((mode) => mode !== cachedMode),
      ],
      ownsProbe: false,
      cachedMode,
    };
  }
  const inFlight = structuredOutputNegotiationInFlight.get(capabilityKey);
  const ownsProbe = inFlight === undefined;
  if (ownsProbe) {
    let resolve!: (mode: StructuredOutputNegotiationResult) => void;
    const promise = new Promise<StructuredOutputNegotiationResult>((settle) => {
      resolve = settle;
    });
    structuredOutputNegotiationInFlight.set(capabilityKey, { promise, resolve });
  }
  return {
    modes: ownsProbe
      ? ['json_schema', 'text']
      : ['text'],
    ownsProbe,
    ...(inFlight ? { probeResult: inFlight.promise } : {}),
  };
}

function finishStructuredOutputNegotiation(
  capabilityKey: string,
  ownsProbe: boolean,
  successfulMode?: OpenAiStructuredOutputMode,
): void {
  if (!ownsProbe) return;
  const inFlight = structuredOutputNegotiationInFlight.get(capabilityKey);
  if (!inFlight) return;
  structuredOutputNegotiationInFlight.delete(capabilityKey);
  inFlight.resolve(successfulMode);
}

function structuredOutputCapabilityKey(
  endpoint: string,
  model: string,
  apiKey: string,
  wireFormat: OpenAiWireFormat,
): string {
  // Do not retain credentials in the process-wide capability cache. The
  // fingerprint prevents one account's provider configuration from being
  // reused for another account using the same endpoint/model pair.
  const keyFingerprint = createHash('sha256')
    .update(apiKey, 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `${wireFormat}|${endpoint}|${model}|${keyFingerprint}`;
}

const DEFAULT_STRUCTURED_OUTPUT_MODES: OpenAiStructuredOutputMode[] = [
  'json_schema',
  'text',
];

function queueFallbackModes(
  modes: OpenAiStructuredOutputMode[],
  currentIndex: number,
  candidates: readonly OpenAiStructuredOutputMode[],
  attemptedModes: ReadonlySet<OpenAiStructuredOutputMode>,
): void {
  let insertAt = currentIndex + 1;
  for (const candidate of candidates) {
    if (candidate === modes[currentIndex] || attemptedModes.has(candidate)) continue;
    const existingIndex = modes.indexOf(candidate);
    if (existingIndex <= currentIndex && existingIndex >= 0) continue;
    if (existingIndex > currentIndex) modes.splice(existingIndex, 1);
    if (!modes.includes(candidate)) {
      modes.splice(insertAt, 0, candidate);
      insertAt += 1;
    }
  }
}

async function parseOpenAiResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error: unknown) {
    throw new VendorAdapterError(
      'invalid_response',
      'The AI service returned an unreadable response envelope.',
      {
        cause: error,
        retryable: true,
        details: {
          responseKind: 'invalid_envelope',
          canRetryWithoutStructuredOutput: true,
        },
      },
    );
  }
}

/**
 * OpenAI-family vendor adapter.
 * Supports CC Switch wire formats:
 * - openai_chat → POST {base}/chat/completions
 * - openai_responses → POST {base}/responses
 */
export class OpenAIVendorAdapter implements VendorAdapter {
  readonly id: VendorId = 'openai';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string | undefined;
  private readonly wireFormat: OpenAiWireFormat;
  private readonly _fetch: typeof fetch;

  constructor(
    apiKey: string,
    model: string,
    customFetch?: typeof fetch,
    baseUrl?: string,
    wireFormat: OpenAiWireFormat = 'openai_chat',
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
    this.wireFormat = wireFormat;
    this._fetch = customFetch ?? globalThis.fetch.bind(globalThis);
  }

  async analyze(
    request: AiAnalysisRequest,
    signal?: AbortSignal,
  ): Promise<AiAnalysisResult> {
    if (this.wireFormat === 'openai_responses') {
      return this.#analyzeResponses(request, signal);
    }
    return this.#analyzeChatCompletions(request, signal);
  }

  async probeConnection(signal?: AbortSignal): Promise<void> {
    let response: Response;
    try {
      if (this.wireFormat === 'openai_responses') {
        response = await this._fetch(resolveOpenAiResponsesUrl(this.baseUrl), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            input: 'Reply with the single word OK.',
            max_output_tokens: 16,
            temperature: 0,
          }),
          signal,
        });
      } else {
        response = await this._fetch(
          resolveOpenAiChatCompletionsUrl(this.baseUrl),
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: this.model,
              messages: [
                { role: 'user', content: 'Reply with the single word OK.' },
              ],
              max_tokens: 16,
              temperature: 0,
            }),
            signal,
          },
        );
      }
    } catch (error: unknown) {
      throw this.#mapFetchError(error);
    }
    if (!response.ok) {
      throw await mapOpenAiHttpError(response);
    }
    try {
      await response.json();
    } catch (error: unknown) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an unreadable response.',
        { cause: error, retryable: true },
      );
    }
  }

  async #analyzeChatCompletions(
    request: AiAnalysisRequest,
    signal?: AbortSignal,
  ): Promise<AiAnalysisResult> {
    const messages = this.#buildChatMessages(request);

    const endpoint = resolveOpenAiChatCompletionsUrl(this.baseUrl);
    const capabilityKey = structuredOutputCapabilityKey(
      endpoint,
      this.model,
      this.apiKey,
      this.wireFormat,
    );
    const negotiation = beginStructuredOutputNegotiation(capabilityKey);
    const modes = [...negotiation.modes];
    const attemptedModes = new Set<OpenAiStructuredOutputMode>();
    let contentFallbackUsed = false;
    let response: Response | undefined;
    let successfulMode: OpenAiStructuredOutputMode | undefined;
    let negotiatedMode: OpenAiStructuredOutputMode | undefined;
    try {
      for (let modeIndex = 0; modeIndex < modes.length; modeIndex += 1) {
        const mode = modes[modeIndex]!;
        attemptedModes.add(mode);
        const body: Record<string, unknown> = {
          model: this.model,
          messages,
          temperature: 0.2,
        };
        if (mode !== 'text') {
          body.response_format = buildOpenAiStructuredResponseFormat(
            mode,
            request.language,
          );
        }
        try {
          response = await this._fetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal,
          });
        } catch (error: unknown) {
          throw this.#mapFetchError(error);
        }

        if (!response.ok) {
          // Only inspect a failed optional envelope. A normal 400 (bad model,
          // credential scope, malformed image, etc.) remains the original error.
          const canInspectFormatFailure =
            (mode !== 'text' || !negotiation.ownsProbe) &&
            (response.status === 400 || response.status === 422);
          if (!canInspectFormatFailure) {
            throw await mapOpenAiHttpError(response, mode);
          }
          let compatibilityBody: string;
          try {
            compatibilityBody = await response.clone().text();
          } catch (error: unknown) {
            if (isAiAbortOrTimeoutError(error)) throw this.#mapFetchError(error);
            throw new VendorAdapterError(
              'invalid_response',
              'The AI service returned an unreadable error response.',
              { cause: error, retryable: true },
            );
          }
          const classification = classifyOpenAiHttpError(
            response.status,
            compatibilityBody,
            mode,
          );
          if (!classification.formatRejected) {
            throw await mapOpenAiHttpError(response, mode);
          }
          if (negotiation.cachedMode === mode) {
            // A provider can be reconfigured after this process cached its
            // capability. Drop the stale entry and renegotiate this request.
            structuredOutputModeByEndpoint.delete(capabilityKey);
          }

          let fallbackModes = classification.suggestedModes ?? (
            mode === 'json_schema' ? ['json_object', 'text'] : ['text']
          );
          if (mode === 'text' && negotiation.probeResult) {
            const probedMode = await negotiation.probeResult;
            const cachedMode = structuredOutputModeByEndpoint.get(capabilityKey) ?? probedMode;
            fallbackModes = cachedMode
              ? [cachedMode, ...OPENAI_STRUCTURED_OUTPUT_MODES]
              : ['json_schema', 'json_object'];
          }
          queueFallbackModes(modes, modeIndex, fallbackModes, attemptedModes);
          continue;
        }

        let json: unknown;
        try {
          json = await parseOpenAiResponseBody(response);
        } catch (error: unknown) {
          if (
            mode !== 'text' &&
            !contentFallbackUsed &&
            canRetryOpenAiResponseWithoutStructuredOutput(error)
          ) {
            contentFallbackUsed = true;
            queueFallbackModes(modes, modeIndex, ['text'], attemptedModes);
            continue;
          }
          throw error;
        }

        const normalized = normalizeOpenAiChatResponse(json, this.model);
        let result: AiAnalysisResult;
        try {
          result = parseOpenAiAnalysisResponse(normalized);
        } catch (error: unknown) {
          if (
            mode !== 'text' &&
            !contentFallbackUsed &&
            canRetryOpenAiResponseWithoutStructuredOutput(error)
          ) {
            contentFallbackUsed = true;
            if (negotiation.cachedMode === mode) {
              structuredOutputModeByEndpoint.delete(capabilityKey);
            }
            queueFallbackModes(modes, modeIndex, ['text'], attemptedModes);
            continue;
          }
          throw error;
        }

        successfulMode = mode;
        // Cache only a mode whose response envelope and domain result both
        // passed validation. HTTP 2xx alone is not a capability proof.
        if (
          negotiation.ownsProbe ||
          negotiation.cachedMode !== undefined ||
          (negotiation.probeResult !== undefined && mode !== 'text')
        ) {
          structuredOutputModeByEndpoint.set(capabilityKey, mode);
        }
        negotiatedMode = successfulMode;
        return result;
      }

      if (!response) {
        throw new VendorAdapterError(
          'invalid_response',
          'The AI service returned no response.',
          { retryable: true },
        );
      }
      throw await mapOpenAiHttpError(response, modes[modes.length - 1]);
    } finally {
      finishStructuredOutputNegotiation(
        capabilityKey,
        negotiation.ownsProbe,
        negotiatedMode,
      );
    }
  }

  async #analyzeResponses(
    request: AiAnalysisRequest,
    signal?: AbortSignal,
  ): Promise<AiAnalysisResult> {
    const endpoint = resolveOpenAiResponsesUrl(this.baseUrl);
    const capabilityKey = structuredOutputCapabilityKey(
      endpoint,
      this.model,
      this.apiKey,
      this.wireFormat,
    );
    const negotiation = beginStructuredOutputNegotiation(capabilityKey);
    const modes = [...negotiation.modes];
    const attemptedModes = new Set<OpenAiStructuredOutputMode>();
    let contentFallbackUsed = false;
    let response: Response | undefined;
    let successfulMode: OpenAiStructuredOutputMode | undefined;
    let negotiatedMode: OpenAiStructuredOutputMode | undefined;
    try {
      for (let modeIndex = 0; modeIndex < modes.length; modeIndex += 1) {
        const mode = modes[modeIndex]!;
        attemptedModes.add(mode);
        const requestBody: Record<string, unknown> = {
          model: this.model,
          instructions: this.#buildSystemPrompt(request),
          input: [
            {
              role: 'user',
              content: this.#buildResponsesUserContent(request),
            },
          ],
          temperature: 0.2,
        };
        if (mode !== 'text') {
          requestBody.text = {
            format: buildOpenAiResponsesTextFormat(mode, request.language),
          };
        }

        try {
          response = await this._fetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal,
          });
        } catch (error: unknown) {
          throw this.#mapFetchError(error);
        }

        if (!response.ok) {
          const canInspectFormatFailure =
            (mode !== 'text' || !negotiation.ownsProbe) &&
            (response.status === 400 || response.status === 422);
          if (!canInspectFormatFailure) {
            throw await mapOpenAiHttpError(response, mode);
          }

          let compatibilityBody: string;
          try {
            compatibilityBody = await response.clone().text();
          } catch (error: unknown) {
            if (isAiAbortOrTimeoutError(error)) throw this.#mapFetchError(error);
            throw new VendorAdapterError(
              'invalid_response',
              'The AI service returned an unreadable error response.',
              { cause: error, retryable: true },
            );
          }
          const classification = classifyOpenAiHttpError(
            response.status,
            compatibilityBody,
            mode,
          );
          if (!classification.formatRejected) {
            throw await mapOpenAiHttpError(response, mode);
          }
          if (negotiation.cachedMode === mode) {
            structuredOutputModeByEndpoint.delete(capabilityKey);
          }

          let fallbackModes = classification.suggestedModes ?? (
            mode === 'json_schema' ? ['json_object', 'text'] : ['text']
          );
          if (mode === 'text' && negotiation.probeResult) {
            const probedMode = await negotiation.probeResult;
            const cachedMode = structuredOutputModeByEndpoint.get(capabilityKey) ?? probedMode;
            fallbackModes = cachedMode
              ? [cachedMode, ...OPENAI_STRUCTURED_OUTPUT_MODES]
              : ['json_schema', 'json_object'];
          }
          queueFallbackModes(modes, modeIndex, fallbackModes, attemptedModes);
          continue;
        }

        let json: unknown;
        try {
          json = await parseOpenAiResponseBody(response);
        } catch (error: unknown) {
          if (
            mode !== 'text' &&
            !contentFallbackUsed &&
            canRetryOpenAiResponseWithoutStructuredOutput(error)
          ) {
            contentFallbackUsed = true;
            queueFallbackModes(modes, modeIndex, ['text'], attemptedModes);
            continue;
          }
          throw error;
        }

        const normalized = normalizeOpenAiResponsesResponse(json, this.model);
        let result: AiAnalysisResult;
        try {
          result = parseOpenAiAnalysisResponse(normalized);
        } catch (error: unknown) {
          if (
            mode !== 'text' &&
            !contentFallbackUsed &&
            canRetryOpenAiResponseWithoutStructuredOutput(error)
          ) {
            contentFallbackUsed = true;
            if (negotiation.cachedMode === mode) {
              structuredOutputModeByEndpoint.delete(capabilityKey);
            }
            queueFallbackModes(modes, modeIndex, ['text'], attemptedModes);
            continue;
          }
          throw error;
        }

        successfulMode = mode;
        if (
          negotiation.ownsProbe ||
          negotiation.cachedMode !== undefined ||
          (negotiation.probeResult !== undefined && mode !== 'text')
        ) {
          structuredOutputModeByEndpoint.set(capabilityKey, mode);
        }
        negotiatedMode = successfulMode;
        return result;
      }

      if (!response) {
        throw new VendorAdapterError(
          'invalid_response',
          'The AI service returned no response.',
          { retryable: true },
        );
      }
      throw await mapOpenAiHttpError(response, modes[modes.length - 1]);
    } finally {
      finishStructuredOutputNegotiation(
        capabilityKey,
        negotiation.ownsProbe,
        negotiatedMode,
      );
    }
  }

  #buildChatMessages(
    request: AiAnalysisRequest,
  ): Array<Record<string, unknown>> {
    return [
      { role: 'system', content: this.#buildSystemPrompt(request) },
      { role: 'user', content: this.#buildChatUserContent(request) },
    ];
  }

  #buildSystemPrompt(request: AiAnalysisRequest): string {
    return (
      buildAiAnalysisSystemPrompt({
        language: request.language,
        settings: resolveAiAnalysisSettings(request),
        enabledFields: request.enabledFields,
        existingTagNames: request.existingTagNames,
      }) + buildJsonOnlySuffix(request.language)
    );
  }

  #buildChatUserContent(
    request: AiAnalysisRequest,
  ): string | Array<Record<string, unknown>> {
    const imageParts: Array<Record<string, unknown>> = [];

    if (request.imageBase64) {
      imageParts.push({
        type: 'image_url',
        image_url: {
          url: `data:${request.mime};base64,${request.imageBase64}`,
          detail: 'low',
        },
      });
    }

    if (request.contactSheetBase64) {
      imageParts.push({
        type: 'image_url',
        image_url: {
          url: `data:${request.contactSheetMime ?? 'image/png'};base64,${request.contactSheetBase64}`,
          detail: 'low',
        },
      });
    }

    const textParts = this.#buildUserTextParts(request);

    if (imageParts.length === 0) {
      return textParts.join('\n');
    }

    return [{ type: 'text', text: textParts.join('\n') }, ...imageParts];
  }

  #buildResponsesUserContent(
    request: AiAnalysisRequest,
  ): Array<Record<string, unknown>> {
    const parts: Array<Record<string, unknown>> = [
      { type: 'input_text', text: this.#buildUserTextParts(request).join('\n') },
    ];

    if (request.imageBase64) {
      parts.push({
        type: 'input_image',
        image_url: `data:${request.mime};base64,${request.imageBase64}`,
        detail: 'low',
      });
    }

    if (request.contactSheetBase64) {
      parts.push({
        type: 'input_image',
        image_url: `data:${request.contactSheetMime ?? 'image/png'};base64,${request.contactSheetBase64}`,
        detail: 'low',
      });
    }

    return parts;
  }

  #buildUserTextParts(request: AiAnalysisRequest): string[] {
    return buildAiAnalysisUserTextLines(request);
  }

  #mapFetchError(error: unknown): VendorAdapterError {
    if (isAiAbortOrTimeoutError(error)) {
      return new VendorAdapterError(
        'timeout',
        'The AI request timed out or was cancelled.',
        { cause: error },
      );
    }

    return new VendorAdapterError(
      'network',
      'Could not reach the AI service.',
      { cause: error },
    );
  }

}
