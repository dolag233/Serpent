import { describe, expect, it, vi } from 'vitest';

import {
  planAiSearch,
} from '../../src/main/ai-search-planner';
import { aiSearchPlanToDefinition } from '../../src/renderer/App';
import { parseRendererRequest } from '../../src/shared/protocol/requests';
import { parseRendererResult } from '../../src/shared/protocol/responses';

const rawPlan = {
  keywords: ['science fiction', 'city'],
  synonyms: ['sci-fi'],
  exclusions: ['sketch'],
  filters: [
    { kind: 'categorical', field: 'format', values: ['png', 'jpg'], ranges: [], exclude: false },
    { kind: 'numeric', field: 'width', values: [], ranges: [{ min: 1920, max: null }], exclude: false },
  ],
  sort: { field: 'created_at', order: 'desc' },
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AI natural-language search planner', () => {
  it('uses OpenAI strict structured output and normalizes to ordinary typed search inputs', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: JSON.stringify(rawPlan) } }],
    }));

    const plan = await planAiSearch({
      apiFormat: 'openai_chat', model: 'gpt-4o-mini', apiKey: 'secret',
      naturalQuery: '科幻城市，不要草图，最新的优先', fetchFn,
    });

    expect(plan).toEqual({
      keywords: ['science fiction', 'city'],
      synonyms: ['sci-fi'],
      exclusions: ['sketch'],
      filters: [
        { field: 'format', values: ['png', 'jpg'], exclude: false },
        { field: 'width', ranges: [{ min: 1920 }], exclude: false },
      ],
      sort: { field: 'created_at', order: 'desc' },
    });
    const [, init] = fetchFn.mock.calls[0]!;
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(request.response_format).toMatchObject({ type: 'json_schema' });
    expect(String(init?.headers)).not.toContain('secret');
  });

  it('uses a Gemini API-key header rather than putting credentials in the URL', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      candidates: [{ content: { parts: [{ text: JSON.stringify(rawPlan) }] } }],
    }));
    await planAiSearch({
      apiFormat: 'gemini_native', model: 'gemini-2.5-flash', apiKey: 'gemini-secret',
      naturalQuery: 'wide city', fetchFn,
    });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).not.toContain('gemini-secret');
    expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'gemini-secret' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      generationConfig: { responseMimeType: 'application/json' },
    });
  });

  it('posts to OpenAI Responses when apiFormat is openai_responses', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(rawPlan) }],
      }],
    }));
    const plan = await planAiSearch({
      apiFormat: 'openai_responses', model: 'gpt-4o-mini', apiKey: 'secret',
      naturalQuery: 'city', languages: ['zh-CN', 'en'], fetchFn,
    });
    expect(plan.keywords).toEqual(['science fiction', 'city']);
    const [url] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain('/responses');
  });

  it('uses DashScope native multimodal generation for the profile model rather than an OpenAI or Anthropic wire format', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      output: {
        choices: [{
          message: { content: [{ text: JSON.stringify(rawPlan) }] },
        }],
      },
    }));
    const plan = await planAiSearch({
      apiFormat: 'dashscope_native',
      model: 'qwen3-vl-plus',
      apiKey: 'secret',
      baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      naturalQuery: 'city',
      fetchFn,
    });

    expect(plan.keywords).toEqual(['science fiction', 'city']);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      parameters: { result_format: 'message', response_format: { type: 'json_object' } },
    });
  });

  it('forces Anthropic to return the one constrained search tool', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      content: [{ type: 'tool_use', name: 'serpent_prepare_search', input: rawPlan }],
    }));
    const plan = await planAiSearch({
      apiFormat: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'secret',
      naturalQuery: 'city', fetchFn,
    });
    expect(plan.keywords).toEqual(['science fiction', 'city']);
    const request = JSON.parse(String(fetchFn.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(request.tool_choice).toEqual({ type: 'tool', name: 'serpent_prepare_search' });
  });

  it('rejects model attempts to add SQL, paths, operators, or malformed typed filters', async () => {
    const malicious = {
      ...rawPlan,
      sql: 'DROP TABLE assets',
    };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: JSON.stringify(malicious) } }],
    }));
    await expect(planAiSearch({
      apiFormat: 'openai_chat', model: 'gpt-4o-mini', apiKey: 'secret', naturalQuery: 'x', fetchFn,
    })).rejects.toMatchObject({ reason: 'AI_INVALID_RESPONSE' });

    const forgedFilter = { ...rawPlan, filters: [{ kind: 'numeric', field: 'tag', values: [], ranges: [{ min: 1, max: 2 }], exclude: false }] };
    fetchFn.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify(forgedFilter) } }] }));
    await expect(planAiSearch({
      apiFormat: 'openai_chat', model: 'gpt-4o-mini', apiKey: 'secret', naturalQuery: 'x', fetchFn,
    })).rejects.toMatchObject({ reason: 'AI_INVALID_RESPONSE' });
  });

  it('classifies refusal, auth, quota and timeout failures without exposing provider text', async () => {
    const refusalFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      choices: [{ message: { refusal: 'provider-private-reason' } }],
    }));
    await expect(planAiSearch({
      apiFormat: 'openai_chat', model: 'model', apiKey: 'secret', naturalQuery: 'x', fetchFn: refusalFetch,
    })).rejects.toMatchObject({ reason: 'AI_REFUSED' });

    for (const [response, reason] of [
      [new Response('', { status: 401 }), 'AI_AUTH'],
      [new Response('{"error":"quota exhausted"}', { status: 429 }), 'AI_QUOTA'],
    ] as const) {
      await expect(planAiSearch({
        apiFormat: 'openai_chat', model: 'model', apiKey: 'secret', naturalQuery: 'x',
        fetchFn: vi.fn<typeof fetch>().mockResolvedValue(response),
      })).rejects.toMatchObject({ reason });
    }

    const abortingFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    await expect(planAiSearch({
      apiFormat: 'openai_chat', model: 'model', apiKey: 'secret', naturalQuery: 'x',
      fetchFn: abortingFetch, timeoutMs: 1,
    })).rejects.toMatchObject({ reason: 'AI_TIMEOUT' });
  });

  it('converts validated terms, exclusions, filters and sort without SQL or paths', () => {
    const definition = aiSearchPlanToDefinition({
      keywords: ['city'], synonyms: ['urban'], exclusions: ['sketch'],
      filters: [{ field: 'favorite', values: [], exclude: false }],
      sort: { field: 'rating', order: 'desc' },
    });
    expect(definition).toEqual({
      search: { clauses: [
        { field: null, values: ['city', 'urban'], exclude: false },
        { field: null, values: ['sketch'], exclude: true },
      ] },
      filters: [{ field: 'favorite', values: [], exclude: false }],
      sort: { field: 'rating', order: 'desc' },
    });
  });

  it('preserves filter-plus-exclusion and exclusion-only plans', () => {
    expect(aiSearchPlanToDefinition({
      keywords: [], synonyms: [], exclusions: ['sketch'],
      filters: [{ field: 'format', values: ['png'], exclude: false }],
    })).toEqual({
      search: { clauses: [{ field: null, values: ['sketch'], exclude: true }] },
      filters: [{ field: 'format', values: ['png'], exclude: false }],
    });
    expect(aiSearchPlanToDefinition({
      keywords: [], synonyms: [], exclusions: ['watermark'], filters: [],
    })).toEqual({
      search: { clauses: [{ field: null, values: ['watermark'], exclude: true }] },
    });
  });

  it('bounds renderer requests and responses at the IPC boundary', () => {
    expect(parseRendererRequest({ type: 'ai.search-plan.request', naturalQuery: '找宽屏城市图' }))
      .toEqual({ type: 'ai.search-plan.request', naturalQuery: '找宽屏城市图' });
    expect(() => parseRendererRequest({
      type: 'ai.search-plan.request', naturalQuery: 'x', sql: 'DROP TABLE assets',
    })).toThrow();
    expect(() => parseRendererRequest({
      type: 'ai.search-plan.request', naturalQuery: 'x'.repeat(2_001),
    })).toThrow();
    expect(parseRendererResult({
      ok: true, type: 'ai.search-plan.result', plan: {
        keywords: ['city'], synonyms: [], exclusions: [], filters: [],
      }, apiFormat: 'openai_chat', model: 'gpt-4o-mini',
    })).toMatchObject({ type: 'ai.search-plan.result' });
    expect(() => parseRendererResult({
      ok: true, type: 'ai.search-plan.result', plan: {
        keywords: ['city'], synonyms: [], exclusions: [], filters: [], sql: 'DROP TABLE assets',
      }, apiFormat: 'openai_chat', model: 'gpt-4o-mini',
    })).toThrow();
  });
});
