import {
  buildAiAnalysisSystemPrompt,
} from '../../shared/ai-analysis-settings';
import {
  resolveOpenAiChatCompletionsUrl,
  resolveOpenAiResponsesUrl,
} from '../../shared/ai-endpoints';
import {
  parseAiAnalysisResultFromModelText,
  resolveAiAnalysisSettings,
} from './protocol';
import type { AiAnalysisRequest, AiAnalysisResult } from './protocol';
import { VendorAdapterError } from './vendor-adapter';
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
    if (this.wireFormat === 'openai_responses') {
      try {
        await this.#probeResponses(signal);
        return;
      } catch (error: unknown) {
        if (
          error instanceof VendorAdapterError &&
          (error.kind === 'invalid_response' || error.kind === 'network')
        ) {
          await this.#probeChatCompletions(signal);
          return;
        }
        throw error;
      }
    }
    await this.#probeChatCompletions(signal);
  }

  async #probeChatCompletions(signal?: AbortSignal): Promise<void> {
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
            messages: [
              { role: 'user', content: 'Reply with the single word OK.' },
            ],
            max_tokens: 16,
            temperature: 0,
          }),
          signal,
        },
      );
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
        { cause: error },
      );
    }
  }

  async #probeResponses(signal?: AbortSignal): Promise<void> {
    let response: Response;
    try {
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
        { cause: error },
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

    // Some midstream relays reject json_object; retry as plain chat text.
    if (response.status === 400) {
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
        { cause: error },
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

    let response: Response;
    try {
      response = await this._fetch(resolveOpenAiResponsesUrl(this.baseUrl), {
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
      throw await this.#mapHttpError(response);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error: unknown) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an unreadable response.',
        { cause: error },
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
          url: `data:image/png;base64,${request.contactSheetBase64}`,
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
        image_url: `data:image/png;base64,${request.contactSheetBase64}`,
        detail: 'low',
      });
    }

    return parts;
  }

  #buildUserTextParts(request: AiAnalysisRequest): string[] {
    const textParts: string[] = [];
    textParts.push(`Filename: ${request.filename}`);

    if (request.contactSheetDescription) {
      textParts.push(
        `Contact sheet description: ${request.contactSheetDescription}`,
      );
    }

    if (request.contactSheetBase64) {
      textParts.push(
        'The first image is the poster frame and the second is a contact sheet of key frames.',
      );
    }

    return textParts;
  }

  #mapFetchError(error: unknown): VendorAdapterError {
    const name =
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      typeof (error as Record<string, unknown>).name === 'string'
        ? ((error as Record<string, unknown>).name as string)
        : '';

    if (name === 'AbortError') {
      return new VendorAdapterError(
        'timeout',
        'The AI request timed out or was cancelled.',
        { cause: error },
      );
    }

    return new VendorAdapterError(
      'network',
      `Could not reach the AI service: ${String(error)}`,
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
    const detail = bodyText.trim().slice(0, 180);
    const message = detail
      ? `AI service returned HTTP ${response.status}: ${detail}`
      : `AI service returned HTTP ${response.status}`;

    return new VendorAdapterError(kind, message);
  }

  #extractChatResult(json: unknown): AiAnalysisResult {
    if (typeof json !== 'object' || json === null) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an unexpected response shape.',
      );
    }

    const body = json as Record<string, unknown>;

    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned no completion choices.',
      );
    }

    const choice = body.choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    const content = message?.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an empty completion.',
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
        { cause: error },
      );
    }
  }

  #extractResponsesResult(json: unknown): AiAnalysisResult {
    if (typeof json !== 'object' || json === null) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an unexpected response shape.',
      );
    }

    const body = json as Record<string, unknown>;
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

    if (!content.trim()) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an empty Responses output.',
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
        { cause: error },
      );
    }
  }
}
