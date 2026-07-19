/**
 * BYOK endpoint helpers aligned with CC Switch `meta.apiFormat` wire protocols:
 * - openai_chat — OpenAI Chat Completions
 * - openai_responses — OpenAI Responses API
 * - anthropic — Anthropic Messages
 * - gemini_native — Google Gemini generateContent
 *
 * Base URL is a prefix (no trailing slash); paths are appended like CC Switch.
 */

export type AiApiFormat =
  | 'openai_chat'
  | 'openai_responses'
  | 'anthropic'
  | 'gemini_native';

/** @deprecated Legacy storage / UI values before apiFormat correction. */
export type LegacyAiProviderId = 'openai' | 'gemini' | 'anthropic';

export const AI_API_FORMATS: readonly AiApiFormat[] = [
  'openai_chat',
  'openai_responses',
  'anthropic',
  'gemini_native',
] as const;

export const AI_API_FORMAT_LABELS: Record<AiApiFormat, string> = {
  openai_chat: 'OpenAI Chat Completions',
  openai_responses: 'OpenAI Responses',
  anthropic: 'Anthropic Messages',
  gemini_native: 'Gemini Native',
};

export const DEFAULT_AI_BASE_URLS: Record<AiApiFormat, string> = {
  openai_chat: 'https://api.openai.com/v1',
  openai_responses: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini_native: 'https://generativelanguage.googleapis.com/v1beta',
};

export const AI_LANGUAGE_OPTIONS = [
  { id: 'zh-CN', labelZh: '中文', labelEn: 'Chinese' },
  { id: 'en', labelZh: 'English', labelEn: 'English' },
  { id: 'ja', labelZh: '日本語', labelEn: 'Japanese' },
  { id: 'ko', labelZh: '한국어', labelEn: 'Korean' },
] as const;

export type AiLanguageId = (typeof AI_LANGUAGE_OPTIONS)[number]['id'];

export const DEFAULT_AI_LANGUAGES: AiLanguageId[] = ['zh-CN', 'en'];

export function isAiApiFormat(value: unknown): value is AiApiFormat {
  return (
    typeof value === 'string' &&
    (AI_API_FORMATS as readonly string[]).includes(value)
  );
}

/** Map legacy provider brand id → CC Switch apiFormat. */
export function migrateLegacyProviderToApiFormat(
  value: unknown,
): AiApiFormat | undefined {
  if (isAiApiFormat(value)) return value;
  switch (value) {
    case 'openai':
      return 'openai_chat';
    case 'gemini':
      return 'gemini_native';
    case 'anthropic':
      return 'anthropic';
    default:
      return undefined;
  }
}

export function normalizeAiBaseUrl(
  baseUrl: string | null | undefined,
): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/u, '');
}

export function effectiveAiBaseUrl(
  apiFormat: AiApiFormat,
  baseUrl?: string | null,
): string {
  return normalizeAiBaseUrl(baseUrl) ?? DEFAULT_AI_BASE_URLS[apiFormat];
}

export function resolveOpenAiChatCompletionsUrl(
  baseUrl?: string | null,
): string {
  return `${effectiveAiBaseUrl('openai_chat', baseUrl)}/chat/completions`;
}

export function resolveOpenAiResponsesUrl(baseUrl?: string | null): string {
  return `${effectiveAiBaseUrl('openai_responses', baseUrl)}/responses`;
}

export function resolveOpenAiModelsUrl(
  apiFormat: 'openai_chat' | 'openai_responses' = 'openai_chat',
  baseUrl?: string | null,
): string {
  return `${effectiveAiBaseUrl(apiFormat, baseUrl)}/models`;
}

export function resolveAnthropicMessagesUrl(baseUrl?: string | null): string {
  const base = effectiveAiBaseUrl('anthropic', baseUrl);
  if (/\/v1$/iu.test(base)) return `${base}/messages`;
  return `${base}/v1/messages`;
}

export function resolveAnthropicModelsUrl(baseUrl?: string | null): string {
  const base = effectiveAiBaseUrl('anthropic', baseUrl);
  if (/\/v1$/iu.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

export function resolveGeminiGenerateContentUrl(
  model: string,
  baseUrl?: string | null,
  options?: { apiKeyQuery?: string },
): string {
  const path = `${effectiveAiBaseUrl('gemini_native', baseUrl)}/models/${encodeURIComponent(model)}:generateContent`;
  if (options?.apiKeyQuery !== undefined) {
    return `${path}?key=${encodeURIComponent(options.apiKeyQuery)}`;
  }
  return path;
}

export function resolveGeminiModelsUrl(baseUrl?: string | null): string {
  return `${effectiveAiBaseUrl('gemini_native', baseUrl)}/models`;
}

/** Concurrency / limiter key shared by wire formats of the same vendor family. */
export function apiFormatLimiterKey(
  apiFormat: AiApiFormat,
): 'openai' | 'gemini' | 'anthropic' {
  switch (apiFormat) {
    case 'openai_chat':
    case 'openai_responses':
      return 'openai';
    case 'gemini_native':
      return 'gemini';
    case 'anthropic':
      return 'anthropic';
  }
}

export function normalizeAiLanguages(value: unknown): AiLanguageId[] {
  const allowed = new Set(
    AI_LANGUAGE_OPTIONS.map((option) => option.id as string),
  );
  if (Array.isArray(value)) {
    const ids = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => allowed.has(item)) as AiLanguageId[];
    return ids.length > 0 ? [...new Set(ids)] : [...DEFAULT_AI_LANGUAGES];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'auto') return [...DEFAULT_AI_LANGUAGES];
    const parts = trimmed
      .split(/[,+/|]/u)
      .map((part) => part.trim())
      .filter((part) => allowed.has(part)) as AiLanguageId[];
    if (parts.length > 0) return [...new Set(parts)];
    if (allowed.has(trimmed)) return [trimmed as AiLanguageId];
  }
  return [...DEFAULT_AI_LANGUAGES];
}

export function formatAiLanguagesForPrompt(languages: readonly string[]): string {
  const labels = languages.map((id) => {
    const option = AI_LANGUAGE_OPTIONS.find((row) => row.id === id);
    return option ? `${option.labelEn} (${option.id})` : id;
  });
  if (labels.length === 0) {
    return 'Chinese (zh-CN) and English (en)';
  }
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

export type ListAiModelsResult =
  | { ok: true; models: string[] }
  | {
      ok: false;
      errorKind: 'auth' | 'permission' | 'network' | 'invalid_response';
      reason: string;
    };

function httpStatusToListError(
  status: number,
): Extract<ListAiModelsResult, { ok: false }>['errorKind'] {
  if (status === 401) return 'auth';
  if (status === 403) return 'permission';
  if (status >= 500) return 'network';
  return 'invalid_response';
}

function parseOpenAiStyleModelIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) ids.push(id.trim());
  }
  return ids;
}

function parseGeminiModelIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const ids: string[] = [];
  for (const row of models) {
    if (!row || typeof row !== 'object') continue;
    const name = (row as { name?: unknown }).name;
    if (typeof name !== 'string' || !name.trim()) continue;
    ids.push(name.replace(/^models\//u, '').trim());
  }
  return ids;
}

/**
 * Fetch available model IDs from a compatible provider endpoint.
 */
export async function listAiModels(input: {
  apiFormat: AiApiFormat;
  apiKey: string;
  baseUrl?: string | null;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ListAiModelsResult> {
  const fetchFn = input.fetchFn ?? globalThis.fetch.bind(globalThis);
  try {
    let response: Response;
    if (
      input.apiFormat === 'openai_chat' ||
      input.apiFormat === 'openai_responses'
    ) {
      response = await fetchFn(
        resolveOpenAiModelsUrl(input.apiFormat, input.baseUrl),
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: input.signal,
        },
      );
    } else if (input.apiFormat === 'anthropic') {
      response = await fetchFn(resolveAnthropicModelsUrl(input.baseUrl), {
        method: 'GET',
        headers: {
          'x-api-key': input.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        signal: input.signal,
      });
    } else {
      const url = `${resolveGeminiModelsUrl(input.baseUrl)}?key=${encodeURIComponent(input.apiKey)}`;
      response = await fetchFn(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: input.signal,
      });
    }

    if (!response.ok) {
      let reason = `HTTP ${response.status}`;
      try {
        const text = await response.text();
        if (text.trim()) reason = text.slice(0, 240);
      } catch {
        // keep status reason
      }
      return {
        ok: false,
        errorKind: httpStatusToListError(response.status),
        reason,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        ok: false,
        errorKind: 'invalid_response',
        reason: 'Model list response was not JSON.',
      };
    }

    const models =
      input.apiFormat === 'gemini_native'
        ? parseGeminiModelIds(body)
        : parseOpenAiStyleModelIds(body);

    if (models.length === 0) {
      return {
        ok: false,
        errorKind: 'invalid_response',
        reason: 'No models returned by the endpoint.',
      };
    }

    return {
      ok: true,
      models: [...new Set(models)].sort((a, b) => a.localeCompare(b)),
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, errorKind: 'network', reason: 'Request timed out.' };
    }
    return {
      ok: false,
      errorKind: 'network',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
