import { describe, expect, it } from 'vitest';

import {
  aiAnalysisResultSchema,
  aiStructuredOutputSchema,
  parseAiAnalysisResult,
} from '../../src/worker/ai/protocol';
import type { AiAnalysisRequest } from '../../src/worker/ai/protocol';
import { OpenAIVendorAdapter } from '../../src/worker/ai/openai-adapter';
import { VendorAdapterError } from '../../src/worker/ai/vendor-adapter';
import { safeAiDiagnostic, vendorFailure } from '../../src/worker/ai/error-mapping';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_IMAGE_REQUEST: AiAnalysisRequest = {
  filename: 'concept-art.png',
  mime: 'image/png',
  imageBase64: 'aW1hZ2VEYXRh', // "imageData" in base64
  language: 'zh-CN',
  enabledFields: {
    description: true,
    tags: true,
    structuredMetadata: false,
  },
  existingTagNames: ['角色设计', '场景概念'],
};

function okFetch(body: unknown): typeof fetch {
  const fn = () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  return fn as unknown as typeof fetch;
}

function httpErrorFetch(
  status: number,
  bodyText = '{}',
): typeof fetch {
  const fn = () =>
    Promise.resolve(
      new Response(bodyText, {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  return fn as unknown as typeof fetch;
}

function networkErrorFetch(error: Error): typeof fetch {
  return (() => Promise.reject(error)) as unknown as typeof fetch;
}

function openAiChatResponse(content: unknown, model = 'gpt-4o-2024-05-13') {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completions',
    created: 1_717_652_288,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify(content),
        },
        finish_reason: 'stop',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Protocol schema tests
// ---------------------------------------------------------------------------

describe('aiStructuredOutputSchema', () => {
  it('accepts a fully populated structured output', () => {
    const result = aiStructuredOutputSchema.parse({
      description: '一幅描绘未来城市的数字概念艺术作品',
      tags: ['城市场景', '科幻', '概念艺术'],
      structured_metadata: { resolution: '4K', style: 'cyberpunk' },
    });

    expect(result).toEqual({
      description: '一幅描绘未来城市的数字概念艺术作品',
      tags: ['城市场景', '科幻', '概念艺术'],
      structured_metadata: { resolution: '4K', style: 'cyberpunk' },
    });
  });

  it('accepts minimal output with only tags', () => {
    const result = aiStructuredOutputSchema.parse({ tags: [] });

    expect(result).toEqual({ tags: [] });
  });

  it('accepts output with only optional fields omitted', () => {
    const result = aiStructuredOutputSchema.parse({
      tags: ['tag-a'],
    });

    expect(result).toEqual({ tags: ['tag-a'] });
  });

  it('rejects output missing the required tags field', () => {
    expect(() =>
      aiStructuredOutputSchema.parse({ description: 'Only description' }),
    ).toThrow();
  });

  it('rejects output with extra unknown fields (strictObject)', () => {
    expect(() =>
      aiStructuredOutputSchema.parse({
        tags: [],
        confidence: 0.95,
      }),
    ).toThrow();
  });

  it('rejects tags that is not an array of strings', () => {
    expect(() =>
      aiStructuredOutputSchema.parse({ tags: 'not-an-array' }),
    ).toThrow();
    expect(() =>
      aiStructuredOutputSchema.parse({ tags: [123] }),
    ).toThrow();
  });
});

describe('vendorFailure', () => {
  it.each([
    ['auth', 'AI_AUTH', false],
    ['permission', 'AI_PERMISSION', false],
    ['quota', 'AI_QUOTA', false],
    ['rate_limit', 'AI_RATE_LIMIT', true],
    ['network', 'AI_NETWORK', true],
    ['timeout', 'AI_TIMEOUT', true],
    ['invalid_response', 'AI_INVALID_RESPONSE', false],
  ] as const)('maps %s to an actionable safe reason', (kind, reason, retryable) => {
    expect(vendorFailure(new VendorAdapterError(kind, 'secret vendor detail'))).toEqual({
      errorCode: `AI_${kind.toUpperCase()}`,
      reason,
      retryable,
    });
  });

  it('creates a cause-bearing diagnostic with safe provider and system details', () => {
    const systemError = Object.assign(
      new Error('fetch https://example.test/path?key=AIza-secret failed with Bearer top-secret'),
      { code: 'ECONNRESET' },
    );
    const diagnostic = safeAiDiagnostic(
      'AI_AUTH',
      new VendorAdapterError('auth', 'AI service returned HTTP 401', { cause: systemError }),
    );
    expect(diagnostic.message).toBe('AI queue analysis failed.');
    expect(diagnostic.cause).toBeInstanceOf(Error);
    expect(String(diagnostic.cause)).toContain('kind=auth; httpStatus=401');
    const nested = (diagnostic.cause as Error).cause;
    expect(String(nested)).toContain('ECONNRESET');
    expect(String(nested)).toContain('key=[redacted]');
    expect(String(nested)).toContain('Bearer [redacted]');
    expect(String(nested)).not.toContain('AIza-secret');
    expect(String(nested)).not.toContain('top-secret');
  });
});

describe('aiAnalysisResultSchema', () => {
  it('accepts a valid result with modelVersion', () => {
    const result = aiAnalysisResultSchema.parse({
      description: 'Desc',
      tags: ['t1'],
      modelVersion: 'gpt-4o-2024-05-13',
    });

    expect(result.modelVersion).toBe('gpt-4o-2024-05-13');
    expect(result.description).toBe('Desc');
  });

  it('rejects a result without modelVersion', () => {
    expect(() =>
      aiAnalysisResultSchema.parse({ description: 'Test', tags: [] }),
    ).toThrow();
  });

  it('rejects a result with empty modelVersion', () => {
    expect(() =>
      aiAnalysisResultSchema.parse({ tags: [], modelVersion: '' }),
    ).toThrow();
  });
});

describe('parseAiAnalysisResult', () => {
  it('parses valid input and returns the typed result', () => {
    const result = parseAiAnalysisResult({
      tags: ['a'],
      modelVersion: 'v1',
    });

    expect(result).toEqual({ tags: ['a'], modelVersion: 'v1' });
  });

  it('throws ZodError on null or non-object input', () => {
    expect(() => parseAiAnalysisResult(null)).toThrow();
    expect(() => parseAiAnalysisResult(undefined)).toThrow();
    expect(() => parseAiAnalysisResult('not-an-object')).toThrow();
  });

  it('throws on an empty object (missing modelVersion)', () => {
    expect(() => parseAiAnalysisResult({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// OpenAI adapter tests (with injected fetch stubs — no network)
// ---------------------------------------------------------------------------

describe('OpenAIVendorAdapter', () => {
  it('sends an OpenAI strict schema whose fields are all required and nullable when optional', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchStub: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(openAiChatResponse({
        description: null,
        tags: ['asset'],
        structured_metadata: null,
      })), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const adapter = new OpenAIVendorAdapter('test-api-key', 'gpt-4o', fetchStub);

    const result = await adapter.analyze(TEST_IMAGE_REQUEST);

    const responseFormat = requestBody?.response_format as Record<string, unknown>;
    const jsonSchema = responseFormat.json_schema as Record<string, unknown>;
    const schema = jsonSchema.schema as Record<string, unknown>;
    expect(schema.required).toEqual(['description', 'tags', 'structured_metadata']);
    expect(result).toEqual({ tags: ['asset'], modelVersion: 'gpt-4o-2024-05-13' });
  });

  it('returns a parsed AiAnalysisResult on successful analysis', async () => {
    const adapter = new OpenAIVendorAdapter(
      'test-api-key',
      'gpt-4o',
      okFetch(
        openAiChatResponse({
          description: '一幅描绘未来城市的数字概念艺术作品',
          tags: ['城市场景', '科幻', '概念艺术'],
        }),
      ),
    );

    const result = await adapter.analyze(TEST_IMAGE_REQUEST);

    expect(result).toEqual({
      description: '一幅描绘未来城市的数字概念艺术作品',
      tags: ['城市场景', '科幻', '概念艺术'],
      modelVersion: 'gpt-4o-2024-05-13',
    });
  });

  it('falls back to the constructor model when API model is missing', async () => {
    const responseBody = {
      id: 'chatcmpl-test',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: JSON.stringify({ tags: ['fallback-test'] }),
          },
          finish_reason: 'stop',
        },
      ],
      // model field deliberately omitted
    };

    const adapter = new OpenAIVendorAdapter(
      'test-api-key',
      'gpt-4o-mini',
      okFetch(responseBody),
    );

    const result = await adapter.analyze(TEST_IMAGE_REQUEST);

    expect(result.modelVersion).toBe('gpt-4o-mini');
    expect(result.tags).toEqual(['fallback-test']);
  });

  it('maps HTTP 401 to auth error kind', async () => {
    const adapter = new OpenAIVendorAdapter(
      'bad-key',
      'gpt-4o',
      httpErrorFetch(401, '{"error":{"message":"Invalid API key"}}'),
    );

    let error: unknown;
    try {
      await adapter.analyze(TEST_IMAGE_REQUEST);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('auth');
  });

  it('maps HTTP 403 to permission error kind', async () => {
    const adapter = new OpenAIVendorAdapter(
      'restricted-key',
      'gpt-4o',
      httpErrorFetch(403),
    );

    let error: unknown;
    try {
      await adapter.analyze(TEST_IMAGE_REQUEST);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('permission');
  });

  it('maps HTTP 429 with quota body to quota error kind', async () => {
    const adapter = new OpenAIVendorAdapter(
      'exhausted-key',
      'gpt-4o',
      httpErrorFetch(
        429,
        JSON.stringify({
          error: {
            message:
              'You exceeded your current quota, please check your plan and billing details.',
            type: 'insufficient_quota',
            code: 'insufficient_quota',
          },
        }),
      ),
    );

    let error: unknown;
    try {
      await adapter.analyze(TEST_IMAGE_REQUEST);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('quota');
  });

  it('maps HTTP 429 without quota body to rate_limit error kind', async () => {
    const adapter = new OpenAIVendorAdapter(
      'rate-limited-key',
      'gpt-4o',
      httpErrorFetch(429, '{"error":{"message":"Rate limit exceeded"}}'),
    );

    let error: unknown;
    try {
      await adapter.analyze(TEST_IMAGE_REQUEST);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('rate_limit');
  });

  it('maps network fetch failure to network error kind', async () => {
    const adapter = new OpenAIVendorAdapter(
      'test-key',
      'gpt-4o',
      networkErrorFetch(new TypeError('fetch failed')),
    );

    let error: unknown;
    try {
      await adapter.analyze(TEST_IMAGE_REQUEST);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('network');
  });

  it('maps AbortError to timeout error kind', async () => {
    const controller = new AbortController();
    controller.abort();

    const adapter = new OpenAIVendorAdapter(
      'test-key',
      'gpt-4o',
      // Simulate what fetch does when signal is already aborted
      networkErrorFetch(
        Object.assign(new Error('The operation was aborted.'), {
          name: 'AbortError',
        }),
      ),
    );

    let error: unknown;
    try {
      await adapter.analyze(TEST_IMAGE_REQUEST, controller.signal);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('timeout');
  });

  it('maps unparseable response body to invalid_response error kind', async () => {
    const adapter = new OpenAIVendorAdapter(
      'test-key',
      'gpt-4o',
      // Return HTML instead of JSON
      httpErrorFetch(200, '<html>Gateway Timeout</html>'),
    );

    let error: unknown;
    try {
      await adapter.analyze(TEST_IMAGE_REQUEST);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('invalid_response');
  });

  it('maps response missing choices to invalid_response error kind', async () => {
    const adapter = new OpenAIVendorAdapter(
      'test-key',
      'gpt-4o',
      okFetch({ id: 'no-choices', choices: [] }),
    );

    let error: unknown;
    try {
      await adapter.analyze(TEST_IMAGE_REQUEST);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('invalid_response');
  });

  it('maps AI output that does not conform to schema to invalid_response', async () => {
    const adapter = new OpenAIVendorAdapter(
      'test-key',
      'gpt-4o',
      okFetch(
        openAiChatResponse({
          // Missing required 'tags' field
          description: 'Some description',
        }),
      ),
    );

    let error: unknown;
    try {
      await adapter.analyze(TEST_IMAGE_REQUEST);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('invalid_response');
  });

  it('maps HTTP 500 to network error kind', async () => {
    const adapter = new OpenAIVendorAdapter(
      'test-key',
      'gpt-4o',
      httpErrorFetch(500),
    );

    let error: unknown;
    try {
      await adapter.analyze(TEST_IMAGE_REQUEST);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('network');
  });

  it('maps HTTP 400 to invalid_response error kind', async () => {
    const adapter = new OpenAIVendorAdapter(
      'test-key',
      'gpt-4o',
      httpErrorFetch(400),
    );

    let error: unknown;
    try {
      await adapter.analyze(TEST_IMAGE_REQUEST);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('invalid_response');
  });
});
