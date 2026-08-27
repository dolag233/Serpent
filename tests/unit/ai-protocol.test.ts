import { describe, expect, it } from 'vitest';

import { DEFAULT_AI_ANALYSIS_SETTINGS } from '../../src/shared/ai-analysis-settings';
import {
  aiAnalysisResultSchema,
  aiStructuredOutputSchema,
  parseAiAnalysisResult,
  parseAiAnalysisResultFromModelText,
} from '../../src/worker/ai/protocol';
import type { AiAnalysisRequest } from '../../src/worker/ai/protocol';
import { DashScopeVendorAdapter } from '../../src/worker/ai/dashscope-adapter';
import {
  isStructuredOutputFormatRejection,
  OpenAIVendorAdapter,
} from '../../src/worker/ai/openai-adapter';
import { VendorAdapterError } from '../../src/worker/ai/vendor-adapter';
import {
  safeAiConnectionFailure,
  safeAiDiagnostic,
  vendorFailure,
} from '../../src/worker/ai/error-mapping';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_IMAGE_REQUEST: AiAnalysisRequest = {
  displayName: 'concept-art.png',
  filename: 'concept-art.png',
  mime: 'image/png',
  imageBase64: 'aW1hZ2VEYXRh', // "imageData" in base64
  language: 'zh-CN',
  enabledFields: {
    description: true,
    tags: true,
    rating: false,
  },
  existingTagNames: ['角色设计', '场景概念'],
  analysisSettings: DEFAULT_AI_ANALYSIS_SETTINGS,
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
      rating: 4,
    });

    expect(result).toEqual({
      description: '一幅描绘未来城市的数字概念艺术作品',
      tags: ['城市场景', '科幻', '概念艺术'],
      rating: 4,
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

  it('permits bounded retry only for a model-output parse failure', () => {
    expect(vendorFailure(new VendorAdapterError(
      'invalid_response',
      'The AI response did not match the required schema.',
      { retryable: true },
    ))).toMatchObject({
      reason: 'AI_INVALID_RESPONSE',
      retryable: true,
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

  it('coerces comma-separated tags string (Serpent-iokf)', () => {
    const result = parseAiAnalysisResult({
      tags: '城市场景, 科幻',
      modelVersion: 'v1',
    });
    expect(result.tags).toEqual(['城市场景', '科幻']);
  });

  it('parses fenced or prose-wrapped JSON from model text', () => {
    const fenced = parseAiAnalysisResultFromModelText(
      '```json\n{"tags":["a"],"description":"d","rating":3}\n```',
      'm1',
    );
    expect(fenced).toEqual({
      tags: ['a'],
      description: 'd',
      rating: 3,
      modelVersion: 'm1',
    });
    const prose = parseAiAnalysisResultFromModelText(
      'Here you go:\n{"tags":["b"]}\nThanks',
      'm2',
    );
    expect(prose).toEqual({ tags: ['b'], modelVersion: 'm2' });
  });
});

// ---------------------------------------------------------------------------
// DashScope adapter tests (native multimodal transport)
// ---------------------------------------------------------------------------

describe('DashScopeVendorAdapter', () => {
  it('uses the native multimodal transport and validates JSON text output', async () => {
    let requestedUrl = '';
    let requestBody: Record<string, unknown> | undefined;
    const fetchStub: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        request_id: 'dashscope-request',
        output: {
          choices: [{
            message: {
              content: [{
                text: JSON.stringify({
                  description: '一张概念设计图',
                  tags: ['概念设计'],
                  rating: 4,
                }),
              }],
            },
          }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const adapter = new DashScopeVendorAdapter(
      'test-api-key',
      'qwen3-vl-plus',
      fetchStub,
      'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    );

    const result = await adapter.analyze(TEST_IMAGE_REQUEST);

    expect(requestedUrl).toBe(
      'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect(requestBody?.parameters).toMatchObject({
      result_format: 'message',
      response_format: { type: 'json_object' },
    });
    const messages = (requestBody?.input as { messages?: Array<{ role: string; content: unknown }> })
      .messages;
    expect(messages?.[0]?.role).toBe('system');
    expect(messages?.[1]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ image: 'data:image/png;base64,aW1hZ2VEYXRh' }),
    ]));
    expect(result).toEqual({
      description: '一张概念设计图',
      tags: ['概念设计'],
      rating: 4,
      modelVersion: 'qwen3-vl-plus',
    });
  });

  it('maps a native authorization failure without leaking response details', async () => {
    const adapter = new DashScopeVendorAdapter(
      'test-api-key',
      'qwen3-vl-plus',
      httpErrorFetch(401, 'credential rejected'),
    );

    await expect(adapter.analyze(TEST_IMAGE_REQUEST)).rejects.toMatchObject({
      name: 'VendorAdapterError',
      kind: 'auth',
      message: 'AI service returned HTTP 401',
    });
  });

  it.each([
    [401, 'credential rejected', 'auth', false],
    [403, 'permission denied', 'permission', false],
    [429, 'too many requests', 'rate_limit', true],
    [429, 'quota exhausted', 'quota', false],
    [500, 'temporary upstream failure', 'network', true],
  ] as const)(
    'classifies native HTTP %i as %s with retryable=%s',
    async (status, body, kind, retryable) => {
      const adapter = new DashScopeVendorAdapter(
        'test-api-key',
        'qwen3-vl-plus',
        httpErrorFetch(status, body),
      );

      await expect(adapter.analyze(TEST_IMAGE_REQUEST)).rejects.toMatchObject({ kind });
      try {
        await adapter.analyze(TEST_IMAGE_REQUEST);
      } catch (error) {
        expect(error).toBeInstanceOf(VendorAdapterError);
        expect(vendorFailure(error as VendorAdapterError).retryable).toBe(retryable);
      }
    },
  );

  it('classifies native network and bounded-retry malformed-output failures', async () => {
    const network = new DashScopeVendorAdapter(
      'test-api-key',
      'qwen3-vl-plus',
      networkErrorFetch(new TypeError('socket closed')),
    );
    await expect(network.analyze(TEST_IMAGE_REQUEST)).rejects.toMatchObject({ kind: 'network' });

    const malformed = new DashScopeVendorAdapter(
      'test-api-key',
      'qwen3-vl-plus',
      okFetch({ output: { choices: [{ message: { content: 'not-json' } }] } }),
    );
    try {
      await malformed.analyze(TEST_IMAGE_REQUEST);
    } catch (error) {
      expect(error).toMatchObject({ kind: 'invalid_response' });
      expect(vendorFailure(error as VendorAdapterError).retryable).toBe(true);
    }
  });

  it('maps a real AbortSignal.timeout rejection to the timeout category', async () => {
    const fetchUntilAborted: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error('Expected an AbortSignal.');
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    const adapter = new DashScopeVendorAdapter(
      'test-api-key',
      'qwen3-vl-plus',
      fetchUntilAborted,
    );

    await expect(adapter.analyze(TEST_IMAGE_REQUEST, AbortSignal.timeout(10)))
      .rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('safe AI connection failures', () => {
  it('never sends credentials or proxy diagnostics across the Worker boundary', () => {
    const result = safeAiConnectionFailure(new VendorAdapterError(
      'network',
      'proxy failed for https://relay.example/?key=secret Bearer sk-super-secret',
    ));

    expect(result).toEqual({
      errorKind: 'network',
      reason: 'Could not reach the AI service.',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

// ---------------------------------------------------------------------------
// OpenAI adapter tests (with injected fetch stubs — no network)
// ---------------------------------------------------------------------------

describe('OpenAIVendorAdapter', () => {
  it('starts OpenAI-compatible analysis with strict json_schema', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchStub: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(openAiChatResponse({
        description: null,
        tags: ['asset'],
        rating: null,
      })), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const adapter = new OpenAIVendorAdapter('test-api-key', 'gpt-4o', fetchStub);

    const result = await adapter.analyze(TEST_IMAGE_REQUEST);

    expect(requestBody?.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'serpent_asset_analysis',
        strict: true,
        schema: {
          required: ['description', 'tags', 'rating'],
          additionalProperties: false,
        },
      },
    });
    const messages = requestBody?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain('Return ONLY one JSON object');
    expect(result).toEqual({ tags: ['asset'], modelVersion: 'gpt-4o-2024-05-13' });
  });

  it('does not let a concurrent text fallback downgrade a schema capability', async () => {
    const requestFormats: unknown[] = [];
    let releaseSchemaProbe: (() => void) | undefined;
    let releaseTextFollower: (() => void) | undefined;
    let schemaProbeStartedResolve: (() => void) | undefined;
    let textFollowerStartedResolve: (() => void) | undefined;
    const schemaProbeStarted = new Promise<void>((resolve) => {
      schemaProbeStartedResolve = resolve;
    });
    const textFollowerStarted = new Promise<void>((resolve) => {
      textFollowerStartedResolve = resolve;
    });
    const schemaProbeGate = new Promise<void>((resolve) => {
      releaseSchemaProbe = resolve;
    });
    const textFollowerGate = new Promise<void>((resolve) => {
      releaseTextFollower = resolve;
    });
    const fetchStub: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const format = body.response_format ?? null;
      requestFormats.push(format);
      if (requestFormats.length === 1) {
        schemaProbeStartedResolve?.();
        await schemaProbeGate;
      } else if (requestFormats.length === 2) {
        textFollowerStartedResolve?.();
        await textFollowerGate;
      }
      return new Response(
        JSON.stringify(openAiChatResponse({ tags: ['concurrent'] })),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const baseUrl = 'https://concurrent-capability-relay.example/v1';
    const leader = new OpenAIVendorAdapter('test-api-key', 'vision-model', fetchStub, baseUrl);
    const follower = new OpenAIVendorAdapter('test-api-key', 'vision-model', fetchStub, baseUrl);

    const leaderResult = leader.analyze(TEST_IMAGE_REQUEST);
    await schemaProbeStarted;
    const followerResult = follower.analyze(TEST_IMAGE_REQUEST);
    await textFollowerStarted;
    releaseSchemaProbe?.();
    await leaderResult;
    releaseTextFollower?.();
    await followerResult;

    await new OpenAIVendorAdapter(
      'test-api-key',
      'vision-model',
      fetchStub,
      baseUrl,
    ).analyze(TEST_IMAGE_REQUEST);

    expect(requestFormats).toHaveLength(3);
    expect(requestFormats[2]).toMatchObject({ type: 'json_schema' });
  });

  it('negotiates json_schema to json_object to text for older local relays', async () => {
    const requestFormats: unknown[] = [];
    const fetchStub: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestFormats.push(body.response_format ?? null);
      if (requestFormats.length < 3) {
        return new Response(
          JSON.stringify({ error: { message: 'response_format must be json_object or text' } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify(openAiChatResponse({ tags: ['local-qwen'] })),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const adapter = new OpenAIVendorAdapter(
      'test-api-key',
      'Qwen2.5-VL-7B-Instruct',
      fetchStub,
      'http://lm-studio.local/v1',
    );

    const result = await adapter.analyze(TEST_IMAGE_REQUEST);

    expect(requestFormats).toEqual([
      expect.objectContaining({ type: 'json_schema' }),
      { type: 'json_object' },
      null,
    ]);
    expect(result.tags).toEqual(['local-qwen']);
  });

  it('uses json_object after a legacy relay explicitly rejects json_schema', async () => {
    const requestFormats: unknown[] = [];
    const fetchStub: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestFormats.push(body.response_format ?? null);
      if (requestFormats.length === 1) {
        return new Response('unsupported response_format json_schema', { status: 422 });
      }
      return new Response(
        JSON.stringify(openAiChatResponse({ tags: ['legacy-relay'] })),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const adapter = new OpenAIVendorAdapter(
      'test-api-key',
      'qwen-legacy',
      fetchStub,
      'http://legacy-relay.local/v1',
    );

    await expect(adapter.analyze(TEST_IMAGE_REQUEST)).resolves.toMatchObject({
      tags: ['legacy-relay'],
    });
    expect(requestFormats).toEqual([
      expect.objectContaining({ type: 'json_schema' }),
      { type: 'json_object' },
    ]);
  });

  it('only classifies explicit response-format compatibility failures', () => {
    expect(isStructuredOutputFormatRejection('response_format must be json_object')).toBe(true);
    expect(isStructuredOutputFormatRejection('unsupported json_schema response format')).toBe(true);
    expect(isStructuredOutputFormatRejection('unknown model: qwen-7b')).toBe(false);
    expect(isStructuredOutputFormatRejection('invalid API key')).toBe(false);
  });

  it('posts to a custom OpenAI-compatible base URL when provided', async () => {
    let requestedUrl = '';
    const fetchStub: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify(
          openAiChatResponse({
            description: null,
            tags: ['asset'],
            rating: null,
          }),
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const adapter = new OpenAIVendorAdapter(
      'test-api-key',
      'gpt-4o',
      fetchStub,
      'https://relay.example/v1',
    );

    await adapter.analyze(TEST_IMAGE_REQUEST);

    expect(requestedUrl).toBe('https://relay.example/v1/chat/completions');
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
    let calls = 0;
    const adapter = new OpenAIVendorAdapter(
      'test-key',
      'gpt-4o',
      (() => {
        calls += 1;
        return Promise.resolve(new Response('unknown model', { status: 400 }));
      }) as typeof fetch,
    );

    let error: unknown;
    try {
      await adapter.analyze(TEST_IMAGE_REQUEST);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('invalid_response');
    expect(calls).toBe(1);
  });

  it('maps a timeout while reading a 400 compatibility body to retryable timeout', async () => {
    const timeout = Object.assign(new Error('body read timed out'), { name: 'TimeoutError' });
    const adapter = new OpenAIVendorAdapter(
      'test-key',
      'gpt-4o',
      (() => Promise.resolve({
        ok: false,
        status: 400,
        clone: () => ({ text: async () => { throw timeout; } }),
      } as unknown as Response)) as typeof fetch,
    );

    await expect(adapter.analyze(TEST_IMAGE_REQUEST)).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('marks a transient successful-but-empty completion envelope retryable', async () => {
    const adapter = new OpenAIVendorAdapter('test-key', 'gpt-4o', okFetch({ choices: [] }));

    await expect(adapter.analyze(TEST_IMAGE_REQUEST)).rejects.toMatchObject({
      kind: 'invalid_response',
      retryable: true,
    });
  });
});
