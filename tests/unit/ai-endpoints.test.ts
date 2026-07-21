import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_AI_BASE_URLS,
  effectiveAiBaseUrl,
  formatAiLanguagesForPrompt,
  listAiModels,
  migrateLegacyProviderToApiFormat,
  normalizeAiBaseUrl,
  normalizeAiLanguages,
  resolveAnthropicMessagesUrl,
  resolveOpenAiChatCompletionsUrl,
  resolveOpenAiModelsUrl,
  resolveOpenAiResponsesUrl,
} from '../../src/shared/ai-endpoints';

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
});
