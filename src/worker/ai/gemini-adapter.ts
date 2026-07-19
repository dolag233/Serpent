import { resolveGeminiGenerateContentUrl } from '../../shared/ai-endpoints';
import { parseAiAnalysisResult } from './protocol';
import type { AiAnalysisRequest, AiAnalysisResult } from './protocol';
import { VendorAdapterError } from './vendor-adapter';
import type { VendorAdapter, VendorId } from './vendor-adapter';

/**
 * Gemini structured-output schema sent via `responseSchema`.
 * Mirrors `aiStructuredOutputSchema` from protocol.ts.
 */
const GEMINI_RESPONSE_SCHEMA = {
  type: 'object' as const,
  properties: {
    description: {
      type: 'string' as const,
      description: 'A detailed description of the asset content. Omit if not applicable.',
    },
    tags: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Relevant keyword tags. Prefer existing library tags when suitable.',
    },
    structured_metadata: {
      type: 'object' as const,
      description: 'Additional structured metadata as key-value pairs. Omit if not applicable.',
    },
  },
  required: ['tags'],
  propertyOrdering: ['description', 'tags', 'structured_metadata'],
};

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
 * Gemini vendor adapter using the Generative Language API
 * (generativelanguage.googleapis.com).
 *
 * Structured output is enforced via `responseSchema` in the
 * generation config.
 */
export class GeminiVendorAdapter implements VendorAdapter {
  readonly id: VendorId = 'gemini';

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
    const contents = this.#buildContents(request);
    const systemInstruction = this.#buildSystemInstruction(request);

    const url = resolveGeminiGenerateContentUrl(this.model, this.baseUrl, {
      apiKeyQuery: this.apiKey,
    });

    let response: Response;
    try {
      response = await this._fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: systemInstruction,
          contents,
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        }),
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

    return this.#extractResult(json);
  }

  // ------------------------------------------------------------------
  // Prompt construction
  // ------------------------------------------------------------------

  #buildSystemInstruction(request: AiAnalysisRequest): {
    parts: Array<{ text: string }>;
  } {
    const text = this.#buildSystemPromptText(request);
    return { parts: [{ text }] };
  }

  #buildSystemPromptText(request: AiAnalysisRequest): string {
    const fields: string[] = [];
    if (request.enabledFields.description) fields.push('description');
    if (request.enabledFields.tags) fields.push('tags');
    if (request.enabledFields.structuredMetadata)
      fields.push('structured_metadata');

    let prompt =
      'You are a digital asset classifier for creative professionals. ' +
      'Analyze the provided asset and return structured classification data.\n\n';
    prompt += `Target languages: ${request.language}\n`;
    prompt +=
      'When multiple languages are listed, write descriptions and tags that remain useful for search in each of those languages (bilingual or multilingual tags are encouraged).\n';
    prompt += `Fill these fields: ${fields.join(', ') || 'tags only'}\n`;

    if (request.existingTagNames.length > 0) {
      prompt +=
        '\nExisting library tags (prefer these when suitable): ' +
        request.existingTagNames.join(', ') +
        '\n';
    }

    return prompt;
  }

  #buildContents(
    request: AiAnalysisRequest,
  ): Array<Record<string, unknown>> {
    const parts: Array<Record<string, unknown>> = [];

    // Text part with context
    const textLines: string[] = [];
    textLines.push(`Filename: ${request.filename}`);
    if (request.contactSheetDescription) {
      textLines.push(
        `Contact sheet description: ${request.contactSheetDescription}`,
      );
    }
    if (request.contactSheetBase64) {
      textLines.push(
        'The first image is the poster frame and the second is a contact sheet of key frames.',
      );
    }
    parts.push({ text: textLines.join('\n') });

    // Image parts
    if (request.imageBase64) {
      parts.push({
        inlineData: {
          mimeType: request.mime,
          data: request.imageBase64,
        },
      });
    }

    if (request.contactSheetBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: request.contactSheetBase64,
        },
      });
    }

    return [{ role: 'user', parts }];
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
      );
    }

    const body = json as Record<string, unknown>;

    // Gemini response format: { candidates: [{ content: { parts: [{ text }] } }] }
    if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned no candidates.',
      );
    }

    const candidate = body.candidates[0] as Record<string, unknown>;
    const content = candidate.content as Record<string, unknown> | undefined;
    const parts =
      content?.parts as Array<Record<string, unknown>> | undefined;

    if (!parts || parts.length === 0) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned an empty response.',
      );
    }

    const text =
      typeof parts[0]?.text === 'string' ? (parts[0].text as string) : '';
    if (!text) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI response contained no text.',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error: unknown) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI response contained invalid JSON.',
        { cause: error },
      );
    }

    const modelVersion =
      typeof body.modelVersion === 'string' && body.modelVersion.length > 0
        ? body.modelVersion
        : this.model;

    try {
      return parseAiAnalysisResult({
        ...(parsed as Record<string, unknown>),
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
