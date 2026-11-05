import { describe, expect, it, vi } from 'vitest';

import { planAiSearch } from '../../src/main/ai-search-planner';
import {
  applyAiRequestRetry,
  classifyAiRequestRetry,
  fetchAiWithPolicyRetry,
  resolveAiRequestPolicy,
  type AiRequestPurpose,
} from '../../src/shared/ai-request-policy';
import { AnthropicVendorAdapter } from '../../src/worker/ai/anthropic-adapter';
import { DashScopeVendorAdapter } from '../../src/worker/ai/dashscope-adapter';
import { GeminiVendorAdapter } from '../../src/worker/ai/gemini-adapter';
import { OpenAIVendorAdapter } from '../../src/worker/ai/openai-adapter';
import type { AiAnalysisRequest } from '../../src/worker/ai/protocol';

const request: AiAnalysisRequest = {
  displayName: 'test.png',
  filename: 'test.png',
  mime: 'image/png',
  language: 'en',
  enabledFields: { description: true, tags: true, rating: false },
  existingTagNames: [],
};

const purposes: AiRequestPurpose[] = ['probe', 'analyze', 'search'];

function policy(
  apiFormat: 'anthropic' | 'openai_chat' | 'openai_responses' | 'gemini_native' | 'dashscope_native',
  baseUrl: string | undefined,
  model: string,
  purpose: AiRequestPurpose,
) {
  return resolveAiRequestPolicy({ apiFormat, baseUrl, model, purpose });
}

describe('resolveAiRequestPolicy', () => {
  it('disables DeepSeek Anthropic thinking for analysis, probe, and search', () => {
    const baseUrl = 'https://api.deepseek.com/anthropic';
    for (const purpose of purposes) {
      expect(policy('anthropic', baseUrl, 'deepseek-flash', purpose).thinking)
        .toEqual({ type: 'disabled' });
    }
    expect(policy('anthropic', baseUrl, 'deepseek-flash', 'probe').maxTokens).toBe(16);
    expect(policy('anthropic', baseUrl, 'deepseek-flash', 'analyze').maxTokens).toBeUndefined();
    expect(policy('anthropic', baseUrl, 'deepseek-flash', 'analyze').temperature).toBe(0.2);
    expect(policy('anthropic', baseUrl, 'deepseek-flash', 'search').temperature).toBe(0);
    expect(policy('anthropic', 'https://API.DEEPSEEK.COM', 'deepseek-v4-pro', 'probe').thinking)
      .toEqual({ type: 'disabled' });
  });

  it('omits thinking for official and unknown Anthropic hosts', () => {
    for (const baseUrl of ['https://api.anthropic.com', 'https://proxy.example/anthropic', undefined]) {
      for (const purpose of purposes) {
        const resolved = policy('anthropic', baseUrl, 'claude-sonnet-4-20250514', purpose);
        expect(resolved.thinking).toBeUndefined();
        expect(resolved.temperature).toBe('keep');
      }
      expect(policy('anthropic', baseUrl, 'claude-opus-4-5', 'probe').maxTokens).toBe(256);
    }
    expect(policy('anthropic', 'https://api.z.ai/api/anthropic', 'glm-5.3', 'analyze').thinking)
      .toBeUndefined();
  });

  it('disables Bailian Anthropic thinking except models whose docs reject disabled', () => {
    const baseUrl = 'https://llm-example.cn-beijing.maas.aliyuncs.com/apps/anthropic';
    expect(policy('anthropic', baseUrl, 'qwen3-vl-plus', 'analyze').thinking)
      .toEqual({ type: 'disabled' });
    expect(policy('anthropic', baseUrl, 'deepseek-v4-pro', 'probe').maxTokens).toBe(16);
    for (const model of ['kimi-k2.7-code', 'glm-5.3', 'glm-5.3-flash', 'minimax-m2.5', 'kimi-k3']) {
      const resolved = policy('anthropic', baseUrl, model, 'analyze');
      expect(resolved.thinking).toBeUndefined();
      expect(resolved.temperature).toBe('omit');
    }
    expect(policy('anthropic', baseUrl, 'kimi-k2.7-code', 'probe').maxTokens).toBe(256);
  });

  it('uses Moonshot fixed temperatures only for models that accept disabled', () => {
    const baseUrl = 'https://api.moonshot.ai/anthropic';
    const k26 = policy('anthropic', baseUrl, 'kimi-k2.6', 'analyze');
    expect(k26.thinking).toEqual({ type: 'disabled' });
    expect(k26.temperature).toBe(0.6);
    expect(policy('anthropic', baseUrl, 'kimi-k2.5', 'probe').maxTokens).toBe(16);
    for (const model of ['kimi-k3', 'kimi-k3.1-pro', 'kimi-k2.7-code']) {
      const resolved = policy('anthropic', baseUrl, model, 'search');
      expect(resolved.thinking).toBeUndefined();
      expect(resolved.temperature).toBe('omit');
    }
    expect(policy('anthropic', baseUrl, 'kimi-k3', 'probe').maxTokens).toBe(256);
    expect(policy('anthropic', baseUrl, 'moonshot-v1', 'analyze')).toMatchObject({
      temperature: 'keep',
    });
    expect(policy('anthropic', baseUrl, 'moonshot-v1', 'analyze').thinking).toBeUndefined();
  });

  it('omits MiniMax thinking and keeps the caller temperature', () => {
    const resolved = policy('anthropic', 'https://api.minimax.io/anthropic', 'MiniMax-M3.1-Flash', 'analyze');
    expect(resolved.thinking).toBeUndefined();
    expect(resolved.temperature).toBe('keep');
    expect(resolved.reasoning).toBeUndefined();
    expect(policy('anthropic', 'https://api.minimax.io/anthropic', 'MiniMax-M3.1-Flash', 'probe').maxTokens)
      .toBe(256);
  });

  it('does not send thinking.type or reasoning_effort none to official OpenAI reasoning models', () => {
    for (const model of ['gpt-5.4', 'gpt-6-astra', 'o1', 'o3-mini', 'o4']) {
      const chat = policy('openai_chat', undefined, model, 'probe');
      const responses = policy('openai_responses', 'https://api.openai.com/v1', model, 'probe');
      expect(chat.thinking).toBeUndefined();
      expect(chat.reasoning).toBeUndefined();
      expect(chat.temperature).toBe('omit');
      expect(chat.maxCompletionTokens).toBe(256);
      expect(chat.maxTokens).toBeUndefined();
      expect(responses.thinking).toBeUndefined();
      expect(responses.reasoning).toBeUndefined();
      expect(responses.maxOutputTokens).toBe(256);
      expect(responses.temperature).toBe('omit');
    }
    const ordinary = policy('openai_chat', undefined, 'gpt-4o', 'probe');
    expect(ordinary.maxTokens).toBe(16);
    expect(ordinary.maxCompletionTokens).toBeUndefined();
    expect(ordinary.temperature).toBe('keep');
  });

  it('disables DeepSeek Chat thinking and DeepSeek Responses effort', () => {
    const chat = policy('openai_chat', 'https://api.deepseek.com', 'deepseek-flash', 'probe');
    expect(chat.thinking).toEqual({ type: 'disabled' });
    expect(chat.maxTokens).toBe(16);
    expect(chat.enableThinking).toBeUndefined();
    const responses = policy('openai_responses', 'https://api.deepseek.com', 'deepseek-v4-pro', 'analyze');
    expect(responses.reasoning).toEqual({ effort: 'none' });
    expect(responses.thinking).toBeUndefined();
    expect(responses.temperature).toBe('keep');
    expect(policy('openai_responses', 'https://api.deepseek.com', 'deepseek-v4-pro', 'probe').maxOutputTokens)
      .toBe(16);
  });

  it('leaves unknown OpenAI-compatible hosts without thinking fields', () => {
    const resolved = policy('openai_chat', 'https://relay.example/v1', 'llama-3', 'probe');
    expect(resolved.thinking).toBeUndefined();
    expect(resolved.reasoning).toBeUndefined();
    expect(resolved.enableThinking).toBeUndefined();
    expect(resolved.maxTokens).toBe(16);
  });

  it('sends enable_thinking false on Bailian Chat and not thinking.type', () => {
    const resolved = policy(
      'openai_chat',
      'https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      'qwen3-vl-plus',
      'analyze',
    );
    expect(resolved.enableThinking).toBe(false);
    expect(resolved.thinking).toBeUndefined();
    expect(policy(
      'openai_chat',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'qwen-plus',
      'probe',
    ).enableThinking).toBe(false);
  });

  it('raises Gemini output caps without a thinking config', () => {
    const analyze = policy('gemini_native', undefined, 'gemini-2.5-pro', 'analyze');
    const probe = policy('gemini_native', undefined, 'gemini-2.5-flash', 'probe');
    const search = policy('gemini_native', undefined, 'gemini-2.5-pro', 'search');
    expect(analyze.maxOutputTokens).toBe(4096);
    expect(probe.maxOutputTokens).toBe(256);
    expect(search.maxOutputTokens).toBeUndefined();
    expect(analyze.thinking).toBeUndefined();
    expect(analyze.temperature).toBe('keep');
  });

  it('closes DashScope native thinking for non-streaming JSON calls', () => {
    const resolved = policy('dashscope_native', undefined, 'qwen3-vl-plus', 'analyze');
    expect(resolved.enableThinking).toBe(false);
    expect(resolved.thinking).toBeUndefined();
    expect(resolved.temperature).toBe('keep');
  });
});

describe('AI request retry', () => {
  it('does not retry when the body matches no recorded phrase', () => {
    expect(classifyAiRequestRetry(400, 'model not found')).toBe('none');
    expect(classifyAiRequestRetry(500, 'restricted to True')).toBe('none');
    expect(classifyAiRequestRetry(400, 'must be set to false for non-streaming calls')).toBe('none');
    const body = {
      parameters: { enable_thinking: false, response_format: { type: 'json_object' } },
    };
    expect(applyAiRequestRetry(body, 'none')).toBe(body);
  });

  it('drops JSON mode and enables thinking when the model forbids disabling it', () => {
    const next = applyAiRequestRetry({
      response_format: { type: 'json_schema' },
      enable_thinking: false,
      parameters: {
        result_format: 'message',
        response_format: { type: 'json_object' },
        enable_thinking: false,
      },
    }, 'enable-thinking-drop-json');
    expect(next.response_format).toBeUndefined();
    expect(next.enable_thinking).toBe(true);
    expect(next.parameters).toEqual({
      result_format: 'message',
      enable_thinking: true,
    });
  });

  it('removes disabled thinking and effort none after an adaptive-thinking rejection', () => {
    const next = applyAiRequestRetry({
      thinking: { type: 'disabled' },
      reasoning: { effort: 'none' },
      reasoning_effort: 'none',
      output_config: { effort: 'none' },
      temperature: 0.2,
    }, 'omit-disabled-thinking');
    expect(next.thinking).toBeUndefined();
    expect(next.reasoning).toBeUndefined();
    expect(next.reasoning_effort).toBeUndefined();
    expect(next.output_config).toBeUndefined();
    expect(next.temperature).toBe(0.2);
  });

  it('posts a second request only for a recorded phrase', async () => {
    const noRetry = vi.fn<typeof fetch>().mockResolvedValue(new Response('model not found', { status: 400 }));
    const first = await fetchAiWithPolicyRetry(
      noRetry,
      'https://example.test',
      { method: 'POST' },
      { thinking: { type: 'disabled' } },
    );
    expect(noRetry).toHaveBeenCalledTimes(1);
    expect(first.action).toBe('none');
    expect(await first.response.text()).toBe('model not found');

    const retry = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (retry.mock.calls.length === 1) {
        return new Response('thinking requires adaptive thinking', { status: 422 });
      }
      expect(body.thinking).toBeUndefined();
      return new Response('{}', { status: 200 });
    });
    const second = await fetchAiWithPolicyRetry(
      retry,
      'https://example.test',
      { method: 'POST' },
      { thinking: { type: 'disabled' }, max_tokens: 16 },
    );
    expect(retry).toHaveBeenCalledTimes(2);
    expect(second.action).toBe('omit-disabled-thinking');
    expect(second.response.status).toBe(200);
  });
});

describe('adapters apply the shared request policy', () => {
  it('sends the same DeepSeek thinking field from analysis and search', async () => {
    const baseUrl = 'https://api.deepseek.com/anthropic';
    const model = 'deepseek-flash';
    let analyzed: Record<string, unknown> | undefined;
    const adapter = new AnthropicVendorAdapter('key', model, (async (_url, init) => {
      analyzed = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        content: [{ type: 'tool_use', name: 'serpent_classify_asset', input: { tags: ['a'] } }],
      }), { status: 200 });
    }) as typeof fetch, baseUrl);
    await adapter.analyze(request);

    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'tool_use', name: 'serpent_prepare_search', input: {
        keywords: ['city'], synonyms: [], exclusions: [], filters: [], sort: null,
      } }],
    }), { status: 200 }));
    await planAiSearch({
      apiFormat: 'anthropic', model, apiKey: 'key', baseUrl, naturalQuery: 'city', fetchFn,
    });
    const searched = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(analyzed?.thinking).toEqual({ type: 'disabled' });
    expect(searched.thinking).toEqual(analyzed?.thinking);
    expect(searched.tool_choice).toEqual({ type: 'tool', name: 'serpent_prepare_search' });
  });

  it('omits thinking for an official Anthropic analysis', async () => {
    let sent: Record<string, unknown> | undefined;
    const adapter = new AnthropicVendorAdapter('key', 'claude-sonnet-4-20250514', (async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        content: [{ type: 'tool_use', name: 'serpent_classify_asset', input: { tags: ['a'] } }],
      }), { status: 200 });
    }) as typeof fetch);
    await adapter.analyze(request);
    expect(sent?.thinking).toBeUndefined();
    expect(sent?.temperature).toBe(0.2);
    expect(sent?.max_tokens).toBe(4096);
  });

  it('uses the official reasoning probe budget without a none effort', async () => {
    let sent: Record<string, unknown> | undefined;
    const adapter = new OpenAIVendorAdapter('key', 'gpt-6-astra', (async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('{}', { status: 200 });
    }) as typeof fetch);
    await adapter.probeConnection();
    expect(sent?.max_completion_tokens).toBe(256);
    expect(sent?.max_tokens).toBeUndefined();
    expect(sent?.temperature).toBeUndefined();
    expect(sent?.thinking).toBeUndefined();
    expect(sent?.reasoning_effort).toBeUndefined();
  });

  it('keeps max_tokens on DeepSeek Chat and effort none on DeepSeek Responses', async () => {
    let chat: Record<string, unknown> | undefined;
    const chatAdapter = new OpenAIVendorAdapter(
      'key',
      'deepseek-flash',
      (async (_url, init) => {
        chat = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
      'https://api.deepseek.com',
    );
    await chatAdapter.probeConnection();
    expect(chat?.thinking).toEqual({ type: 'disabled' });
    expect(chat?.max_tokens).toBe(16);
    expect(chat?.enable_thinking).toBeUndefined();

    let responses: Record<string, unknown> | undefined;
    const responsesAdapter = new OpenAIVendorAdapter(
      'key',
      'deepseek-v4-pro',
      (async (_url, init) => {
        responses = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
      'https://api.deepseek.com',
      'openai_responses',
    );
    await responsesAdapter.probeConnection();
    expect(responses?.reasoning).toEqual({ effort: 'none' });
    expect(responses?.max_output_tokens).toBe(16);
    expect(responses?.thinking).toBeUndefined();
  });

  it('sets Gemini output caps and does not send thinkingConfig', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchStub = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"tags":["a"]}' }] } }],
      }), { status: 200 });
    }) as typeof fetch;
    const adapter = new GeminiVendorAdapter('key', 'gemini-2.5-pro', fetchStub);
    await adapter.analyze(request);
    await adapter.probeConnection();
    const analyzed = bodies[0]?.generationConfig as Record<string, unknown>;
    const probed = bodies[1]?.generationConfig as Record<string, unknown>;
    expect(analyzed.maxOutputTokens).toBe(4096);
    expect(analyzed.thinkingConfig).toBeUndefined();
    expect(analyzed.temperature).toBe(0.2);
    expect(probed.maxOutputTokens).toBe(256);
    expect(probed.thinkingConfig).toBeUndefined();
  });

  it('retries a DashScope call once when thinking cannot be disabled', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const recordingFetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (bodies.length === 1) {
        return new Response(JSON.stringify({
          message: 'enable_thinking is restricted to True for this model',
        }), { status: 400 });
      }
      return new Response(JSON.stringify({
        output: { choices: [{ message: { content: [{ text: '{"tags":["a"]}' }] } }] },
      }), { status: 200 });
    }) as typeof fetch;
    const adapter = new DashScopeVendorAdapter('key', 'qwen3.7-plus', recordingFetch);
    await adapter.analyze(request);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.parameters).toMatchObject({
      enable_thinking: false,
      response_format: { type: 'json_object' },
    });
    expect((bodies[1]?.parameters as Record<string, unknown>).enable_thinking).toBe(true);
    expect((bodies[1]?.parameters as Record<string, unknown>).response_format).toBeUndefined();
    expect(bodies[1]?.enable_thinking).toBeUndefined();
  });

  it('does not post a second DashScope request for an unrelated 400', async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(new Response('model not found', { status: 400 }));
    const adapter = new DashScopeVendorAdapter('key', 'qwen3-vl-plus', fetchStub);
    await expect(adapter.analyze(request)).rejects.toMatchObject({ kind: 'invalid_response' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
