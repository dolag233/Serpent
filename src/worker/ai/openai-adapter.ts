import { parseAiAnalysisResult } from './protocol';
import type { AiAnalysisRequest, AiAnalysisResult } from './protocol';
import { VendorAdapterError } from './vendor-adapter';
import type { VendorAdapter, VendorId } from './vendor-adapter';

/**
 * OpenAI structured-output JSON Schema sent alongside every request.
 * Mirrors `aiStructuredOutputSchema` from protocol.ts — keep them in
 * sync whenever the Serpent contract changes.
 */
const OPENAI_RESPONSE_JSON_SCHEMA = {
  name: 'asset_classification',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      label: {
        type: ['string', 'null'],
        description:
          'A concise title or label for the asset. Omit if not applicable.',
      },
      description: {
        type: ['string', 'null'],
        description:
          'A detailed description of the asset content. Omit if not applicable.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Relevant keyword tags. Prefer existing library tags when suitable.',
      },
      structured_metadata: {
        type: ['object', 'null'],
        properties: {},
        additionalProperties: false,
        description:
          'Additional structured metadata as key-value pairs. Omit if not applicable.',
      },
    },
    required: ['label', 'description', 'tags', 'structured_metadata'],
    additionalProperties: false,
  },
};

/**
 * Maps an HTTP status code and response body to a VendorAdapterError kind.
 * Callers use the discriminated kind to decide retry vs permanent failure.
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
      // OpenAI returns 429 for both rate-limit and quota-exhausted.
      // Distinguish by body content — "insufficient_quota" is the
      // canonical type string.
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

/**
 * OpenAI vendor adapter implementing the unified {@link VendorAdapter}
 * interface via the chat completions API with structured output.
 *
 * The adapter accepts the API key through the constructor — never
 * hardcoded.  A custom `fetch` implementation can be injected for
 * testing.
 */
export class OpenAIVendorAdapter implements VendorAdapter {
  readonly id: VendorId = 'openai';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly _fetch: typeof fetch;

  constructor(apiKey: string, model: string, customFetch?: typeof fetch) {
    this.apiKey = apiKey;
    this.model = model;
    this._fetch = customFetch ?? globalThis.fetch.bind(globalThis);
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  async analyze(
    request: AiAnalysisRequest,
    signal?: AbortSignal,
  ): Promise<AiAnalysisResult> {
    const messages = this.#buildMessages(request);

    let response: Response;
    try {
      response = await this._fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            response_format: {
              type: 'json_schema',
              json_schema: OPENAI_RESPONSE_JSON_SCHEMA,
            },
            temperature: 0.2,
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

    return this.#extractResult(json);
  }

  // ------------------------------------------------------------------
  // Prompt construction
  // ------------------------------------------------------------------

  #buildMessages(
    request: AiAnalysisRequest,
  ): Array<Record<string, unknown>> {
    return [
      { role: 'system', content: this.#buildSystemPrompt(request) },
      { role: 'user', content: this.#buildUserContent(request) },
    ];
  }

  #buildSystemPrompt(request: AiAnalysisRequest): string {
    const fields: string[] = [];
    if (request.enabledFields.label) fields.push('label');
    if (request.enabledFields.description) fields.push('description');
    if (request.enabledFields.tags) fields.push('tags');
    if (request.enabledFields.structuredMetadata)
      fields.push('structured_metadata');

    let prompt =
      'You are a digital asset classifier for creative professionals. ' +
      'Analyze the provided asset and return structured classification data.\n\n';
    prompt += `Target language: ${request.language}\n`;
    prompt += `Fill these fields: ${fields.join(', ') || 'tags only'}\n`;

    if (request.existingTagNames.length > 0) {
      prompt +=
        '\nExisting library tags (prefer these when suitable): ' +
        request.existingTagNames.join(', ') +
        '\n';
    }

    return prompt;
  }

  #buildUserContent(
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

    if (imageParts.length === 0) {
      return textParts.join('\n');
    }

    return [{ type: 'text', text: textParts.join('\n') }, ...imageParts];
  }

  // ------------------------------------------------------------------
  // Error mapping
  // ------------------------------------------------------------------

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

    if (!message || typeof message.content !== 'string') {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an empty message.',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch (error: unknown) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI response contained invalid JSON.',
        { cause: error },
      );
    }

    const modelVersion =
      typeof body.model === 'string' && body.model.length > 0
        ? body.model
        : this.model;

    try {
      const normalized = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([, value]) => value !== null),
      );
      return parseAiAnalysisResult({
        ...normalized,
        modelVersion,
      });
    } catch (error: unknown) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI response did not match the required schema.',
        { cause: error },
      );
    }
  }
}
