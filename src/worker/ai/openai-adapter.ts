import {
  buildAiAnalysisSystemPrompt,
} from '../../shared/ai-analysis-settings';
import {
  resolveOpenAiChatCompletionsUrl,
  resolveOpenAiResponsesUrl,
} from '../../shared/ai-endpoints';
import {
  buildAiAnalysisUserTextLines,
  parseAiAnalysisResultFromModelText,
  resolveAiAnalysisSettings,
} from './protocol';
import type { AiAnalysisRequest, AiAnalysisResult } from './protocol';
import { isAiAbortOrTimeoutError, VendorAdapterError } from './vendor-adapter';
import type { VendorAdapter, VendorId } from './vendor-adapter';

/**
 * Ask for a plain JSON object in the prompt. Prefer `json_object` over
 * strict `json_schema` — most midstream OpenAI-compatible relays reject
 * json_schema and only return text / loose JSON (Serpent-0s4i / p4c6).
 */
function buildJsonOnlySuffix(language: string): string {
  return (
    `\nReturn ONLY one JSON object (no markdown fences) with keys ` +
    `description (string|null), tags (string[]), rating (1-5|null). ` +
    `Write description and tags in ${language}.`
  );
}

function httpStatusToErrorKind(
  status: number,
  bodyText: string,
): VendorAdapterError['kind'] {
  switch (status) {
    case 401:
      return 'auth';
    case 403:
      return 'permission';
    case 429: {
      const lower = bodyText.toLowerCase();
      if (lower.includes('quota') || lower.includes('insufficient')) {
        return 'quota';
      }
      return 'rate_limit';
    }
    case 400:
      return 'invalid_response';
    default:
      if (status >= 500) {
        return 'network';
      }
      return 'invalid_response';
  }
}

export type OpenAiWireFormat = 'openai_chat' | 'openai_responses';

type ResponsesTextFormatSupport = 'supported' | 'unsupported';

// Adapter instances are intentionally short lived (one analysis request), so
// this process-wide capability cache avoids paying a failed structured-output
// request for every asset on a compatibility relay that only returns text.
const responsesTextFormatSupportByEndpoint = new Map<
  string,
  ResponsesTextFormatSupport
>();
// Adapters are constructed per asset. Coordinate the initial capability
// negotiation so a high-concurrency first batch does not send the same
// known-incompatible structured-output probe once per asset.
const responsesTextFormatNegotiationByEndpoint = new Set<string>();

function isUnsupportedResponsesTextFormat(body: string): boolean {
  const format = '(?:text\\.format|response_format|json_object|structured\\s+output)';
  const unsupported = '(?:unsupported|not\\s+supported|unknown|invalid)';
  return new RegExp(
    `(?:${format}.{0,120}${unsupported}|${unsupported}.{0,120}${format})`,
    'iu',
  ).test(body);
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
      throw await this.#mapHttpError(response);
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

    let response: Response;
    try {
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
            messages,
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
          signal,
        },
      );
    } catch (error: unknown) {
      throw this.#mapFetchError(error);
    }

    // Some midstream relays reject json_object; retry as plain chat text only
    // when the response specifically identifies that optional envelope. An
    // ordinary 400 (bad model, credential scope, malformed request) is not a
    // second provider attempt.
    let chatFormatRejected = false;
    if (response.status === 400) {
      try {
        chatFormatRejected = isUnsupportedResponsesTextFormat(
          await response.clone().text(),
        );
      } catch (error: unknown) {
        if (isAiAbortOrTimeoutError(error)) throw this.#mapFetchError(error);
        throw new VendorAdapterError(
          'invalid_response',
          'The AI service returned an unreadable response.',
          { cause: error, retryable: true },
        );
      }
    }
    if (chatFormatRejected) {
      try {
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
              messages,
              temperature: 0.2,
            }),
            signal,
          },
        );
      } catch (error: unknown) {
        throw this.#mapFetchError(error);
      }
    }

    if (!response.ok) {
      throw await this.#mapHttpError(response);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error: unknown) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an unreadable response.',
        { cause: error, retryable: true },
      );
    }

    return this.#extractChatResult(json);
  }

  async #analyzeResponses(
    request: AiAnalysisRequest,
    signal?: AbortSignal,
  ): Promise<AiAnalysisResult> {
    const body = {
      model: this.model,
      instructions: this.#buildSystemPrompt(request),
      input: [
        {
          role: 'user',
          content: this.#buildResponsesUserContent(request),
        },
      ],
      text: {
        format: { type: 'json_object' },
      },
      temperature: 0.2,
    };

    const endpoint = resolveOpenAiResponsesUrl(this.baseUrl);
    const supportsTextFormat = responsesTextFormatSupportByEndpoint.get(endpoint);
    const negotiation = supportsTextFormat === undefined
      && !responsesTextFormatNegotiationByEndpoint.has(endpoint);
    if (negotiation) responsesTextFormatNegotiationByEndpoint.add(endpoint);
    const settleNegotiation = (support: ResponsesTextFormatSupport | undefined): void => {
      if (!negotiation) return;
      if (support !== undefined) {
        responsesTextFormatSupportByEndpoint.set(endpoint, support);
      }
      responsesTextFormatNegotiationByEndpoint.delete(endpoint);
    };
    const plainTextBody = {
      model: body.model,
      instructions: body.instructions,
      input: body.input,
      temperature: body.temperature,
    };
    // A follower in the very first batch must not reserve a global model slot
    // while awaiting the leader's probe. It sends the portable text-only
    // contract immediately; the leader alone decides/caches capability.
    const requestBody = supportsTextFormat === 'unsupported' || !negotiation
      ? plainTextBody
      : body;
    let response: Response;
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
      settleNegotiation(undefined);
      throw this.#mapFetchError(error);
    }

    // Compatible Responses relays frequently implement the endpoint and
    // multimodal input but reject OpenAI's optional `text.format` envelope.
    // The system prompt still requires one JSON object, so retrying without
    // this envelope preserves a portable plain-text result contract without
    // weakening Serpent's schema validation after receipt.
    let structuredOutputRejected = false;
    if (negotiation && response.status === 400) {
      try {
        structuredOutputRejected = isUnsupportedResponsesTextFormat(
          await response.clone().text(),
        );
      } catch (error: unknown) {
        settleNegotiation(undefined);
        if (isAiAbortOrTimeoutError(error)) throw this.#mapFetchError(error);
        throw new VendorAdapterError(
          'invalid_response',
          'The AI service returned an unreadable response.',
          { cause: error, retryable: true },
        );
      }
    }
    if (structuredOutputRejected) {
      settleNegotiation('unsupported');
      try {
        response = await this._fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(plainTextBody),
          signal,
        });
      } catch (error: unknown) {
        throw this.#mapFetchError(error);
      }
    } else if (negotiation) {
      settleNegotiation(response.ok ? 'supported' : undefined);
    }

    if (!response.ok) {
      throw await this.#mapHttpError(response);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error: unknown) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an unreadable response.',
        { cause: error, retryable: true },
      );
    }

    return this.#extractResponsesResult(json);
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

  async #mapHttpError(response: Response): Promise<VendorAdapterError> {
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      // Ignore — body is not essential for error classification.
    }

    const kind = httpStatusToErrorKind(response.status, bodyText);
    return new VendorAdapterError(kind, `AI service returned HTTP ${response.status}`);
  }

  #extractChatResult(json: unknown): AiAnalysisResult {
    if (typeof json !== 'object' || json === null) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an unexpected response shape.',
        { retryable: true },
      );
    }

    const body = json as Record<string, unknown>;

    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned no completion choices.',
        { retryable: true },
      );
    }

    const choice = body.choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    const content = message?.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an empty completion.',
        { retryable: true },
      );
    }

    const modelVersion =
      typeof body.model === 'string' && body.model.trim()
        ? body.model
        : this.model;

    try {
      return parseAiAnalysisResultFromModelText(content, modelVersion);
    } catch (error: unknown) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI response did not match the required schema.',
        { cause: error, retryable: true },
      );
    }
  }

  #extractResponsesResult(json: unknown): AiAnalysisResult {
    if (typeof json !== 'object' || json === null) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an unexpected response shape.',
        { retryable: true },
      );
    }

    const body = json as Record<string, unknown>;
    const textFromContent = (value: unknown): string => {
      if (typeof value === 'string') return value;
      if (!Array.isArray(value)) return '';
      return value
        .filter((part): part is Record<string, unknown> =>
          Boolean(part) && typeof part === 'object',
        )
        .map((part) => part.text)
        .filter((part): part is string => typeof part === 'string')
        .join('');
    };
    let content = '';

    if (typeof body.output_text === 'string' && body.output_text.trim()) {
      content = body.output_text;
    } else if (Array.isArray(body.output)) {
      for (const item of body.output) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        if (row.type !== 'message' || !Array.isArray(row.content)) continue;
        for (const part of row.content) {
          if (!part || typeof part !== 'object') continue;
          const block = part as Record<string, unknown>;
          if (
            (block.type === 'output_text' || block.type === 'text') &&
            typeof block.text === 'string'
          ) {
            content += block.text;
          }
        }
      }
    }

    // Some nominal Responses relays return an OpenAI Chat-style envelope, or
    // a DashScope-style `output.choices` envelope. Keep the network protocol
    // tolerant, but feed every variant through the same strict JSON/schema
    // parser below so a relay cannot write arbitrary asset metadata.
    if (!content.trim()) {
      const chatChoice = Array.isArray(body.choices) ? body.choices[0] : undefined;
      if (chatChoice && typeof chatChoice === 'object') {
        const message = (chatChoice as Record<string, unknown>).message;
        if (message && typeof message === 'object') {
          content = textFromContent((message as Record<string, unknown>).content);
        }
      }
    }
    if (!content.trim() && body.output && typeof body.output === 'object') {
      const choices = (body.output as Record<string, unknown>).choices;
      const choice = Array.isArray(choices) ? choices[0] : undefined;
      if (choice && typeof choice === 'object') {
        const message = (choice as Record<string, unknown>).message;
        if (message && typeof message === 'object') {
          content = textFromContent((message as Record<string, unknown>).content);
        }
      }
    }

    if (!content.trim()) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an empty Responses output.',
        { retryable: true },
      );
    }

    const modelVersion =
      typeof body.model === 'string' && body.model.trim()
        ? body.model
        : this.model;

    try {
      return parseAiAnalysisResultFromModelText(content, modelVersion);
    } catch (error: unknown) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI response did not match the required schema.',
        { cause: error, retryable: true },
      );
    }
  }
}
