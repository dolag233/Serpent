import { buildAiAnalysisSystemPrompt } from '../../shared/ai-analysis-settings';
import { resolveDashScopeMultimodalGenerationUrl } from '../../shared/ai-endpoints';
import {
  parseAiAnalysisResultFromModelText,
  resolveAiAnalysisSettings,
} from './protocol';
import type { AiAnalysisRequest, AiAnalysisResult } from './protocol';
import { isAiAbortOrTimeoutError, VendorAdapterError } from './vendor-adapter';
import type { VendorAdapter, VendorId } from './vendor-adapter';

function httpStatusToErrorKind(
  status: number,
  bodyText: string,
): VendorAdapterError['kind'] {
  switch (status) {
    case 401:
      return 'auth';
    case 403:
      return 'permission';
    case 429:
      return bodyText.toLowerCase().includes('quota')
        ? 'quota'
        : 'rate_limit';
    case 400:
      return 'invalid_response';
    default:
      return status >= 500 ? 'network' : 'invalid_response';
  }
}

/**
 * Alibaba Cloud Model Studio's native DashScope multimodal transport.
 *
 * The response is still a JSON HTTP envelope, but the model result is a
 * JSON-object text value. That portable result is validated by Serpent's
 * existing domain schema before an asset can be written.
 */
export class DashScopeVendorAdapter implements VendorAdapter {
  readonly id: VendorId = 'dashscope';

  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(
    apiKey: string,
    model: string,
    customFetch?: typeof fetch,
    baseUrl?: string,
  ) {
    this.#apiKey = apiKey;
    this.#model = model;
    this.#baseUrl = baseUrl;
    this.#fetch = customFetch ?? globalThis.fetch.bind(globalThis);
  }

  async analyze(
    request: AiAnalysisRequest,
    signal?: AbortSignal,
  ): Promise<AiAnalysisResult> {
    const body = {
      model: this.#model,
      input: {
        messages: [
          {
            role: 'system',
            content: this.#buildSystemPrompt(request),
          },
          {
            role: 'user',
            content: this.#buildUserContent(request),
          },
        ],
      },
      parameters: {
        result_format: 'message',
        response_format: { type: 'json_object' },
        temperature: 0.2,
      },
    };

    let response: Response;
    try {
      response = await this.#fetch(
        resolveDashScopeMultimodalGenerationUrl(this.#baseUrl),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal,
        },
      );
    } catch (error: unknown) {
      throw this.#mapFetchError(error);
    }
    if (!response.ok) throw await this.#mapHttpError(response);

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
    let response: Response;
    try {
      response = await this.#fetch(
        resolveDashScopeMultimodalGenerationUrl(this.#baseUrl),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.#model,
            input: {
              messages: [{
                role: 'user',
                content: 'Reply with the single word OK.',
              }],
            },
            parameters: { result_format: 'message', temperature: 0 },
          }),
          signal,
        },
      );
    } catch (error: unknown) {
      throw this.#mapFetchError(error);
    }
    if (!response.ok) throw await this.#mapHttpError(response);
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

  #buildSystemPrompt(request: AiAnalysisRequest): string {
    return buildAiAnalysisSystemPrompt({
      language: request.language,
      settings: resolveAiAnalysisSettings(request),
      enabledFields: request.enabledFields,
      existingTagNames: request.existingTagNames,
    }) + '\nReturn only one JSON object with no Markdown fences.\n';
  }

  #buildUserContent(request: AiAnalysisRequest): Array<Record<string, string>> {
    const content: Array<Record<string, string>> = [];
    if (request.imageBase64) {
      content.push({
        image: `data:${request.mime};base64,${request.imageBase64}`,
      });
    }
    if (request.contactSheetBase64) {
      content.push({ image: `data:image/png;base64,${request.contactSheetBase64}` });
    }
    const lines = [`Filename: ${request.filename}`];
    if (request.contactSheetDescription) {
      lines.push(`Contact sheet description: ${request.contactSheetDescription}`);
    }
    if (request.contactSheetBase64) {
      lines.push('The first image is the poster frame and the second is a contact sheet of key frames.');
    }
    content.push({ text: lines.join('\n') });
    return content;
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
      // Status remains sufficient for safe error classification.
    }
    return new VendorAdapterError(
      httpStatusToErrorKind(response.status, bodyText),
      `AI service returned HTTP ${response.status}`,
    );
  }

  #extractResult(json: unknown): AiAnalysisResult {
    if (!json || typeof json !== 'object') {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an unexpected response shape.',
        { retryable: true },
      );
    }
    const body = json as Record<string, unknown>;
    const output = body.output;
    if (!output || typeof output !== 'object') {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned no output.',
        { retryable: true },
      );
    }
    const choices = (output as Record<string, unknown>).choices;
    const first = Array.isArray(choices) ? choices[0] : undefined;
    const message = first && typeof first === 'object'
      ? (first as Record<string, unknown>).message
      : undefined;
    const content = message && typeof message === 'object'
      ? (message as Record<string, unknown>).content
      : undefined;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
          .filter((part): part is Record<string, unknown> =>
            Boolean(part) && typeof part === 'object',
          )
          .map((part) => part.text)
          .filter((part): part is string => typeof part === 'string')
          .join('')
        : '';
    if (!text.trim()) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI response contained no text.',
        { retryable: true },
      );
    }
    const modelVersion = typeof body.model === 'string' && body.model.trim()
      ? body.model
      : this.#model;
    try {
      return parseAiAnalysisResultFromModelText(text, modelVersion);
    } catch (error: unknown) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI response did not match the required analysis schema.',
        { cause: error, retryable: true },
      );
    }
  }
}
