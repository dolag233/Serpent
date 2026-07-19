import { resolveAnthropicMessagesUrl } from '../../shared/ai-endpoints';
import { parseAiAnalysisResult } from './protocol';
import type { AiAnalysisRequest, AiAnalysisResult } from './protocol';
import { VendorAdapterError } from './vendor-adapter';
import type { VendorAdapter, VendorId } from './vendor-adapter';

/**
 * Anthropic structured-output JSON Schema sent as a tool's `input_schema`.
 * Claude does not support `json_schema` response_format natively;
 * we use tool-use with a single tool whose `input_schema` forces
 * structured output, then extract the tool-call arguments.
 */
const ANTHROPIC_TOOL_INPUT_SCHEMA = {
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
  required: ['tags'] as string[],
};

const ANTHROPIC_TOOL_DEFINITION = {
  name: 'serpent_classify_asset',
  description:
    'Classify a digital asset for a creative professional library. ' +
    'Provide a description, tags, and structured metadata.',
  input_schema: ANTHROPIC_TOOL_INPUT_SCHEMA,
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
      tools: [ANTHROPIC_TOOL_DEFINITION],
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
        { cause: error },
      );
    }

    return this.#extractResult(json);
  }

  // ------------------------------------------------------------------
  // Prompt construction
  // ------------------------------------------------------------------

  #buildSystemPrompt(request: AiAnalysisRequest): string {
    const fields: string[] = [];
    if (request.enabledFields.description) fields.push('description');
    if (request.enabledFields.tags) fields.push('tags');
    if (request.enabledFields.structuredMetadata)
      fields.push('structured_metadata');

    let prompt =
      'You are a digital asset classifier for creative professionals. ' +
      'Analyze the provided asset and return structured classification data ' +
      'by calling the `serpent_classify_asset` tool.\n\n';
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

  #buildMessages(
    request: AiAnalysisRequest,
  ): Array<Record<string, unknown>> {
    const content: Array<Record<string, unknown>> = [];

    // Text part
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
          media_type: 'image/png',
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

    // Anthropic response format:
    // { content: [{ type: 'tool_use', input: {...} }], model: '...', ... }
    if (!Array.isArray(body.content) || body.content.length === 0) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI service returned no content blocks.',
      );
    }

    const block = body.content[0] as Record<string, unknown>;
    if (block.type !== 'tool_use') {
      // Claude might refuse; check for tool_use in other blocks
      let foundToolUse = false;
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
                { cause: error },
              );
            }
          }
          foundToolUse = true;
        }
      }
      if (foundToolUse) {
        throw new VendorAdapterError(
          'invalid_response',
          'The AI tool-use input was empty.',
        );
      }
      throw new VendorAdapterError(
        'invalid_response',
        `Expected tool_use response but got ${String(block.type)}.`,
      );
    }

    const input = block.input as Record<string, unknown> | undefined;
    if (!input) {
      throw new VendorAdapterError(
        'invalid_response',
        'The AI tool-use input was empty.',
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
        { cause: error },
      );
    }
  }
}
