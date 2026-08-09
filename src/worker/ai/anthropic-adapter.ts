import {
  aiTagsSchemaDescription,
  buildAiAnalysisSystemPrompt,
} from '../../shared/ai-analysis-settings';
import { resolveAnthropicMessagesUrl } from '../../shared/ai-endpoints';
import { buildAiAnalysisUserTextLines, parseAiAnalysisResult, resolveAiAnalysisSettings } from './protocol';
import type { AiAnalysisRequest, AiAnalysisResult } from './protocol';
import { isAiAbortOrTimeoutError, VendorAdapterError } from './vendor-adapter';
import type { VendorAdapter, VendorId } from './vendor-adapter';

/**
 * Anthropic structured-output JSON Schema sent as a tool's `input_schema`.
 * Claude does not support `json_schema` response_format natively;
 * we use tool-use with a single tool whose `input_schema` forces
 * structured output, then extract the tool-call arguments.
 */
function buildAnthropicToolDefinition(language: string) {
  return {
    name: 'serpent_classify_asset',
    description:
      'Classify a digital asset for a creative professional library. ' +
      `Provide description and tags in ${language}, and an optional aesthetic rating.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        description: {
          type: ['string', 'null'] as const,
          description: `Description of the asset content in ${language}, or null if skipped.`,
        },
        tags: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: aiTagsSchemaDescription(language),
        },
        rating: {
          type: ['integer', 'null'] as const,
          description: 'Aesthetic score from 1 to 5, or null if unknown.',
        },
      },
      required: ['tags'] as string[],
    },
  };
}

/**
 * Maps HTTP status + body to a VendorAdapterError kind.
 */
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
      if (lower.includes('quota') || lower.includes('exhausted')) {
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

/**
 * Anthropic (Claude) vendor adapter using the Messages API
 * (api.anthropic.com/v1/messages).
 *
 * Structured output is enforced via tool-use: we define a single
 * tool `serpent_classify_asset` with the structured `input_schema`
 * and instruct the model to call it.
 */
export class AnthropicVendorAdapter implements VendorAdapter {
  readonly id: VendorId = 'anthropic';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string | undefined;
  private readonly _fetch: typeof fetch;

  constructor(
    apiKey: string,
    model: string,
    customFetch?: typeof fetch,
    baseUrl?: string,
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
    this._fetch = customFetch ?? globalThis.fetch.bind(globalThis);
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  async analyze(
    request: AiAnalysisRequest,
    signal?: AbortSignal,
  ): Promise<AiAnalysisResult> {
    const system = this.#buildSystemPrompt(request);
    const messages = this.#buildMessages(request);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      temperature: 0.2,
      system,
      messages,
      tools: [buildAnthropicToolDefinition(request.language)],
      tool_choice: {
        type: 'tool' as const,
        name: 'serpent_classify_asset',
      },
    };

    let response: Response;
    try {
      response = await this._fetch(
        resolveAnthropicMessagesUrl(this.baseUrl),
        {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal,
        },
      );
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
        { cause: error, retryable: true },
      );
    }

    return this.#extractResult(json);
  }

  async probeConnection(signal?: AbortSignal): Promise<void> {
    // No tools / vision — midstream proxies often return plain text for
    // classification tool_choice, which is fine for a reachability check.
    let response: Response;
    try {
      response = await this._fetch(
        resolveAnthropicMessagesUrl(this.baseUrl),
        {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 16,
            temperature: 0,
            messages: [
              {
                role: 'user',
                content: 'Reply with the single word OK.',
              },
            ],
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
    // Body shape is irrelevant for probe; HTTP success is enough.
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

  // ------------------------------------------------------------------
  // Prompt construction
  // ------------------------------------------------------------------

  #buildSystemPrompt(request: AiAnalysisRequest): string {
    return (
      buildAiAnalysisSystemPrompt({
        language: request.language,
        settings: resolveAiAnalysisSettings(request),
        enabledFields: request.enabledFields,
        existingTagNames: request.existingTagNames,
      }) +
      '\n通过调用 `serpent_classify_asset` 工具返回结果。\n'
    );
  }

  #buildMessages(
    request: AiAnalysisRequest,
  ): Array<Record<string, unknown>> {
    const content: Array<Record<string, unknown>> = [];

    // Text part
    const textLines = buildAiAnalysisUserTextLines(request);

    content.push({
      type: 'text',
      text: textLines.join('\n'),
    });

    // Image parts
    if (request.imageBase64) {
      // Anthropic expects media_type matching the actual image format.
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: request.mime,
          data: request.imageBase64,
        },
      });
    }

    if (request.contactSheetBase64) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: request.contactSheetMime ?? 'image/png',
          data: request.contactSheetBase64,
        },
      });
    }

    return [{ role: 'user', content }];
  }

  // ------------------------------------------------------------------
  // Error mapping
  // ------------------------------------------------------------------

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
      // Ignore.
    }

    const kind = httpStatusToErrorKind(response.status, bodyText);
    const message = `AI service returned HTTP ${response.status}`;

    return new VendorAdapterError(kind, message);
  }

  // ------------------------------------------------------------------
  // Response extraction
  // ------------------------------------------------------------------

  #extractResult(json: unknown): AiAnalysisResult {
    if (typeof json !== 'object' || json === null) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an unexpected response shape.',
        { retryable: true },
      );
    }

    const body = json as Record<string, unknown>;

    // Anthropic response format:
    // { content: [{ type: 'tool_use', input: {...} }], model: '...', ... }
    if (!Array.isArray(body.content) || body.content.length === 0) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned no content blocks.',
        { retryable: true },
      );
    }

    const block = body.content[0] as Record<string, unknown>;
    if (block.type !== 'tool_use') {
      // Claude might refuse; check for tool_use in other blocks
      for (const b of body.content as Array<Record<string, unknown>>) {
        if (b.type === 'tool_use') {
          const input = b.input as Record<string, unknown> | undefined;
          if (input) {
            const modelVersion =
              typeof body.model === 'string' && body.model.length > 0
                ? body.model
                : this.model;

            try {
              return parseAiAnalysisResult({
                ...input,
                modelVersion,
              });
            } catch (error: unknown) {
              throw new VendorAdapterError(
                'invalid_response',
                'The AI response did not match the required schema.',
                { cause: error, retryable: true },
              );
            }
          }
              throw new VendorAdapterError(
                'invalid_response',
                'The AI tool-use input was empty.',
                { retryable: true },
          );
        }
      }
      // Serpent-iokf: some Anthropic-compatible proxies return plain text JSON
      // instead of tool_use — accept that when it parses.
      const textFallback = this.#tryParseTextContentAsResult(body);
      if (textFallback) return textFallback;
      throw new VendorAdapterError(
        'invalid_response',
        `Expected tool_use response but got ${String(block.type)}.`,
        { retryable: true },
      );
    }

    const input = block.input as Record<string, unknown> | undefined;
    if (!input) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI tool-use input was empty.',
        { retryable: true },
      );
    }

    const modelVersion =
      typeof body.model === 'string' && body.model.length > 0
        ? body.model
        : this.model;

    try {
      return parseAiAnalysisResult({
        ...input,
        modelVersion,
      });
    } catch (error: unknown) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI response did not match the required schema.',
        { cause: error, retryable: true },
      );
    }
  }

  #tryParseTextContentAsResult(
    body: Record<string, unknown>,
  ): AiAnalysisResult | undefined {
    if (!Array.isArray(body.content)) return undefined;
    const modelVersion =
      typeof body.model === 'string' && body.model.length > 0
        ? body.model
        : this.model;
    for (const b of body.content as Array<Record<string, unknown>>) {
      if (b.type !== 'text' || typeof b.text !== 'string') continue;
      const raw = b.text.trim();
      if (!raw) continue;
      const fenced = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      try {
        const parsed = JSON.parse(fenced) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parseAiAnalysisResult({
            ...(parsed as Record<string, unknown>),
            modelVersion,
          });
        }
      } catch {
        // keep looking
      }
    }
    return undefined;
  }
}
