import { describe, expect, it, vi } from 'vitest';

import {
  AI_API_FORMATS,
  DEFAULT_AI_API_FORMAT,
  DEFAULT_AI_BASE_URLS,
  DEFAULT_AI_MODELS,
  anthropicCustomBaseUrlMissesProtocolPath,
  effectiveAiBaseUrl,
  formatAiLanguagesForPrompt,
  listAiModels,
  migrateLegacyProviderToApiFormat,
  normalizeAiBaseUrl,
  normalizeAiLanguages,
  resolveAnthropicMessagesUrl,
  resolveDashScopeMultimodalGenerationUrl,
  resolveOpenAiChatCompletionsUrl,
  resolveOpenAiModelsUrl,
  resolveOpenAiResponsesUrl,
} from '../../src/shared/ai-endpoints';

describe('AI API format defaults (user decision 2026-09-13)', () => {
  it('defaults to Anthropic Messages', () => {
    expect(DEFAULT_AI_API_FORMAT).toBe('anthropic');
    expect(AI_API_FORMATS).toContain(DEFAULT_AI_API_FORMAT);
  });

  /**
   * Format and model are one pair. A fresh profile that defaulted the wire
   * protocol to Anthropic while keeping the old DashScope model id would fail
   * its first probe with a confusing provider error, so the pairing is asserted
   * for every format rather than only for the default.
   */
  it('pairs every format with a non-empty default model', () => {
    expect(DEFAULT_AI_MODELS[DEFAULT_AI_API_FORMAT]).toBe('claude-sonnet-4-20250514');
    for (const format of AI_API_FORMATS) {
      expect(DEFAULT_AI_MODELS[format]?.trim().length ?? 0).toBeGreaterThan(0);
      expect(DEFAULT_AI_BASE_URLS[format]?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('ai-endpoints URL resolution', () => {
  it('uses official defaults when baseUrl is empty', () => {
    expect(normalizeAiBaseUrl('')).toBeUndefined();
    expect(effectiveAiBaseUrl('openai_chat')).toBe(DEFAULT_AI_BASE_URLS.openai_chat);
    expect(resolveOpenAiChatCompletionsUrl()).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(resolveOpenAiResponsesUrl()).toBe(
      'https://api.openai.com/v1/responses',
    );
    expect(resolveAnthropicMessagesUrl()).toBe(
      'https://api.anthropic.com/v1/messages',
    );
    expect(resolveDashScopeMultimodalGenerationUrl()).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
  });

  it('adds /v1 for host-only OpenAI bases but keeps path prefixes (CC Switch style)', () => {
    expect(resolveOpenAiChatCompletionsUrl('https://relay.example')).toBe(
      'https://relay.example/v1/chat/completions',
    );
    expect(resolveOpenAiChatCompletionsUrl('https://relay.example/v1')).toBe(
      'https://relay.example/v1/chat/completions',
    );
    expect(resolveOpenAiResponsesUrl('https://api.qcode.cc/openai')).toBe(
      'https://api.qcode.cc/openai/responses',
    );
    expect(resolveOpenAiChatCompletionsUrl('https://relay.example/v1/')).toBe(
      'https://relay.example/v1/chat/completions',
    );
  });

  it('collapses duplicated /v1/v1 when joining', () => {
    expect(resolveOpenAiModelsUrl('openai_chat', 'https://relay.example/v1')).toBe(
      'https://relay.example/v1/models',
    );
    expect(resolveAnthropicMessagesUrl('https://proxy.example/api')).toBe(
      'https://proxy.example/api/v1/messages',
    );
    expect(resolveAnthropicMessagesUrl('https://proxy.example/v1')).toBe(
      'https://proxy.example/v1/messages',
    );
    expect(resolveAnthropicMessagesUrl('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/v1/messages',
    );
    expect(resolveAnthropicMessagesUrl('https://api.deepseek.com/anthropic')).toBe(
      'https://api.deepseek.com/anthropic/v1/messages',
    );
  });

  it('flags host-only custom Anthropic bases and accepts a protocol path or the official host', () => {
    expect(anthropicCustomBaseUrlMissesProtocolPath('https://api.deepseek.com')).toBe(true);
    expect(anthropicCustomBaseUrlMissesProtocolPath('https://api.deepseek.com/')).toBe(true);
    expect(anthropicCustomBaseUrlMissesProtocolPath('https://api.deepseek.com/anthropic')).toBe(false);
    expect(anthropicCustomBaseUrlMissesProtocolPath('https://api.anthropic.com')).toBe(false);
    expect(anthropicCustomBaseUrlMissesProtocolPath('')).toBe(false);
  });

  it('converts Model Studio compatible-mode workspace URLs to the native DashScope root', () => {
    expect(resolveDashScopeMultimodalGenerationUrl(
      'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    )).toBe(
      'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
  });

  it('maps legacy provider brands to CC Switch apiFormat', () => {
    expect(migrateLegacyProviderToApiFormat('openai')).toBe('openai_chat');
    expect(migrateLegacyProviderToApiFormat('gemini')).toBe('gemini_native');
    expect(migrateLegacyProviderToApiFormat('anthropic')).toBe('anthropic');
    expect(migrateLegacyProviderToApiFormat('openai_responses')).toBe(
      'openai_responses',
    );
  });

  it('normalizes to a single language (first pick) with zh-CN default', () => {
    expect(normalizeAiLanguages('auto')).toEqual(['zh-CN']);
    expect(normalizeAiLanguages('zh-CN')).toEqual(['zh-CN']);
    expect(normalizeAiLanguages(['en', 'zh-CN', 'en'])).toEqual(['en']);
    expect(formatAiLanguagesForPrompt(['zh-CN'])).toContain('Chinese');
    expect(formatAiLanguagesForPrompt(['en'])).toContain('English');
  });
});

describe('listAiModels', () => {
  it('parses OpenAI-compatible model lists for chat format', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const result = await listAiModels({
      apiFormat: 'openai_chat',
      apiKey: 'sk-test',
      baseUrl: 'https://relay.example/v1',
      fetchFn,
    });

    expect(result).toEqual({
      ok: true,
      models: ['gpt-4o', 'gpt-4o-mini'],
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://relay.example/v1/models',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('reads DashScope native model ids from GET /api/v1/models and follows pages', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = url.searchParams.get('page_no');
      const body = page === '1'
        ? {
            success: true,
            output: {
              total: 3,
              page_no: 1,
              page_size: 2,
              models: [
                { model: 'qwen3-vl-plus', name: '通义千问 VL Plus' },
                { model: ' qwen-plus ', name: '通义千问 Plus' },
              ],
            },
          }
        : {
            success: true,
            output: {
              total: 3,
              page_no: 2,
              page_size: 2,
              models: [{ model: 'qwen3-vl-flash' }],
            },
          };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await listAiModels({
      apiFormat: 'dashscope_native',
      apiKey: 'sk-test',
      baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      fetchFn,
    });

    expect(result).toEqual({
      ok: true,
      models: ['qwen-plus', 'qwen3-vl-flash', 'qwen3-vl-plus'],
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const firstUrl = String(vi.mocked(fetchFn).mock.calls[0]?.[0]);
    const secondUrl = String(vi.mocked(fetchFn).mock.calls[1]?.[0]);
    expect(firstUrl).toBe(
      'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/models?page_no=1&page_size=100',
    );
    expect(secondUrl).toContain('page_no=2');
    expect(firstUrl).not.toContain('sk-test');
    expect(vi.mocked(fetchFn).mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer sk-test' },
    });
  });

  it('reports a DashScope model-list auth failure without reading another page', async () => {
    const fetchFn = vi.fn(async () => new Response('InvalidApiKey', { status: 401 })) as unknown as typeof fetch;
    const result = await listAiModels({
      apiFormat: 'dashscope_native',
      apiKey: 'sk-test',
      fetchFn,
    });
    expect(result).toMatchObject({ ok: false, errorKind: 'auth' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetchFn).mock.calls[0]?.[0])).toBe(
      'https://dashscope.aliyuncs.com/api/v1/models?page_no=1&page_size=100',
    );
  });

  it('lists Bailian models from the workspace catalog when the profile uses the Anthropic prefix', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      output: {
        total: 1,
        models: [{ model: 'qwen3-vl-plus' }],
      },
    }), { status: 200 })) as unknown as typeof fetch;
    const baseUrl = 'https://llm-example.cn-beijing.maas.aliyuncs.com/apps/anthropic';

    const result = await listAiModels({
      apiFormat: 'anthropic',
      apiKey: 'sk-test',
      baseUrl,
      fetchFn,
    });

    expect(result).toEqual({ ok: true, models: ['qwen3-vl-plus'] });
    const url = String(vi.mocked(fetchFn).mock.calls[0]?.[0]);
    expect(url).toBe(
      'https://llm-example.cn-beijing.maas.aliyuncs.com/api/v1/models?page_no=1&page_size=100',
    );
    expect(url).not.toContain('/apps/anthropic');
    expect(vi.mocked(fetchFn).mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer sk-test' },
    });
  });
});
