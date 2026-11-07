/**
 * Host- and model-specific request fields shared by analysis, connection
 * probes, and search planning.
 *
 * Rules and the phrases that permit one retry are recorded in
 * docs/internal/research/2026-11-03-mainstream-model-api-formats.md and
 * docs/internal/implementation/2026-11-03-ai-request-policy-plan.md.
 * Model-name prefixes apply only after the hostname selects a vendor whose
 * own docs bind the constraint to that model family.
 */

import { DEFAULT_AI_BASE_URLS, type AiApiFormat } from './ai-endpoints';

export type AiRequestPurpose = 'probe' | 'analyze' | 'search';

export type AiRequestPolicyInput = {
  apiFormat: AiApiFormat;
  baseUrl?: string;
  model: string;
  purpose: AiRequestPurpose;
};

export type AiSampling = number | 'keep' | 'omit';

export type AiRequestPolicy = {
  /** `keep` leaves the caller's temperature. `omit` removes it. */
  temperature: AiSampling;
  thinking?: { type: 'disabled' };
  reasoning?: { effort: 'none' };
  /** Bailian Chat and DashScope native. Absent means the field is not sent. */
  enableThinking?: false;
  maxTokens?: number;
  maxCompletionTokens?: number;
  maxOutputTokens?: number;
};

export type AiRequestRetryAction =
  | 'none'
  | 'enable-thinking-drop-json'
  | 'omit-disabled-thinking';

const DISABLED_THINKING = { type: 'disabled' } as const;
const BAILIAN_ANTHROPIC_REJECTS_DISABLED = [
  'kimi-k2.7-code',
  'kimi-k3',
  'glm-5.3',
  'minimax-',
] as const;
const OFFICIAL_OPENAI_REASONING_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5', 'gpt-6'] as const;

export function collapseProviderMessage(bodyText: string): string {
  return bodyText.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function resolveAiRequestPolicy(input: AiRequestPolicyInput): AiRequestPolicy {
  const host = requestHostname(input.baseUrl, input.apiFormat);
  switch (input.apiFormat) {
    case 'anthropic':
      return anthropicPolicy(host, input.model, input.purpose);
    case 'openai_chat':
      return openAiChatPolicy(host, input.model, input.purpose);
    case 'openai_responses':
      return openAiResponsesPolicy(host, input.model, input.purpose);
    case 'gemini_native':
      return geminiPolicy(input.purpose);
    case 'dashscope_native':
      return { temperature: 'keep', enableThinking: false };
    default: {
      const unreachable: never = input.apiFormat;
      return unreachable;
    }
  }
}

export function applyAiRequestPolicy(
  body: Record<string, unknown>,
  input: AiRequestPolicyInput,
): Record<string, unknown> {
  const policy = resolveAiRequestPolicy(input);
  const next: Record<string, unknown> = { ...body };
  const nestedTemperature = input.apiFormat === 'gemini_native'
    || input.apiFormat === 'dashscope_native';

  if (policy.temperature === 'omit') {
    delete next.temperature;
  } else if (typeof policy.temperature === 'number' && !nestedTemperature) {
    next.temperature = policy.temperature;
  }

  if (policy.thinking) next.thinking = policy.thinking;
  else delete next.thinking;
  if (policy.reasoning) next.reasoning = policy.reasoning;
  else delete next.reasoning;

  if (input.apiFormat === 'openai_chat' && policy.enableThinking === false) {
    next.enable_thinking = false;
  } else {
    delete next.enable_thinking;
  }

  if (policy.maxCompletionTokens !== undefined) {
    next.max_completion_tokens = policy.maxCompletionTokens;
    delete next.max_tokens;
  } else if (policy.maxTokens !== undefined) {
    next.max_tokens = policy.maxTokens;
    delete next.max_completion_tokens;
  }

  if (input.apiFormat === 'openai_responses' && policy.maxOutputTokens !== undefined) {
    next.max_output_tokens = policy.maxOutputTokens;
  }

  if (input.apiFormat === 'gemini_native') {
    const generationConfig = copyRecord(next.generationConfig);
    if (policy.temperature === 'omit') delete generationConfig.temperature;
    else if (typeof policy.temperature === 'number') {
      generationConfig.temperature = policy.temperature;
    }
    if (policy.maxOutputTokens !== undefined) {
      generationConfig.maxOutputTokens = policy.maxOutputTokens;
    }
    delete generationConfig.thinkingConfig;
    next.generationConfig = generationConfig;
  }

  if (input.apiFormat === 'dashscope_native') {
    const parameters = copyRecord(next.parameters);
    if (policy.temperature === 'omit') delete parameters.temperature;
    else if (typeof policy.temperature === 'number') {
      parameters.temperature = policy.temperature;
    }
    if (policy.enableThinking === false) parameters.enable_thinking = false;
    else delete parameters.enable_thinking;
    next.parameters = parameters;
  }

  return next;
}

export function classifyAiRequestRetry(
  status: number,
  providerMessage: string,
): AiRequestRetryAction {
  if (status !== 400 && status !== 422) return 'none';
  const text = providerMessage.replace(/\s+/g, ' ');
  if (text.includes('restricted to True')) return 'enable-thinking-drop-json';
  if (text.includes('requires adaptive thinking')) return 'omit-disabled-thinking';
  return 'none';
}

export function applyAiRequestRetry(
  body: Record<string, unknown>,
  action: AiRequestRetryAction,
): Record<string, unknown> {
  if (action === 'none') return body;
  const next: Record<string, unknown> = { ...body };
  if (action === 'enable-thinking-drop-json') {
    delete next.response_format;
    // Native DashScope keeps the switch inside parameters. Adding a top-level
    // enable_thinking field there is not part of that request shape.
    if (!isRecord(next.parameters) || 'enable_thinking' in next) {
      next.enable_thinking = true;
    }
    if (isRecord(next.parameters)) {
      const parameters = { ...next.parameters };
      delete parameters.response_format;
      parameters.enable_thinking = true;
      next.parameters = parameters;
    }
    return next;
  }

  if (isDisabledThinking(next.thinking)) delete next.thinking;
  if (isNoneEffort(next.reasoning)) delete next.reasoning;
  if (next.reasoning_effort === 'none') delete next.reasoning_effort;
  if (isRecord(next.output_config) && next.output_config.effort === 'none') {
    const outputConfig = { ...next.output_config };
    delete outputConfig.effort;
    if (Object.keys(outputConfig).length === 0) delete next.output_config;
    else next.output_config = outputConfig;
  }
  return next;
}

/**
 * One extra POST when the response quotes a recorded provider sentence.
 * A non-matching 400/422 leaves the original response readable. The body is
 * inspected through a clone when the runtime provides one.
 */
export async function fetchAiWithPolicyRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  body: Record<string, unknown>,
): Promise<{ response: Response; action: AiRequestRetryAction }> {
  const send = (payload: Record<string, unknown>) => fetchImpl(url, {
    ...init,
    body: JSON.stringify(payload),
  });
  const first = await send(body);
  if (first.status !== 400 && first.status !== 422) {
    return { response: first, action: 'none' };
  }
  // Read a clone so a caller can still inspect the original body when this
  // status does not match a retry phrase. A timeout while reading that body
  // stays a timeout instead of being replaced by a reconstructed response.
  const text = typeof first.clone === 'function'
    ? await first.clone().text()
    : await first.text();
  const action = classifyAiRequestRetry(first.status, text);
  if (action === 'none') {
    if (typeof first.clone === 'function') return { response: first, action };
    return {
      response: new Response(text, {
        status: first.status,
        statusText: first.statusText,
        headers: first.headers,
      }),
      action,
    };
  }
  return {
    response: await send(applyAiRequestRetry(body, action)),
    action,
  };
}

function anthropicPolicy(
  host: string,
  model: string,
  purpose: AiRequestPurpose,
): AiRequestPolicy {
  if (host === 'api.deepseek.com') return disabledAnthropic(purpose);
  if (isMaasHost(host)) {
    return rejectsDisabledThinking(model)
      ? omittedAnthropic(purpose, 'omit')
      : disabledAnthropic(purpose);
  }
  if (host === 'api.moonshot.ai') {
    if (hasModelPrefix(model, 'kimi-k2.7-code') || hasModelPrefix(model, 'kimi-k3')) {
      return omittedAnthropic(purpose, 'omit');
    }
    if (hasModelPrefix(model, 'kimi-k2.5') || hasModelPrefix(model, 'kimi-k2.6')) {
      return {
        temperature: 0.6,
        thinking: DISABLED_THINKING,
        ...probeMaxTokens(purpose, 16),
      };
    }
    // Models not listed by the Kimi docs stay on the host default.
    return omittedAnthropic(purpose, 'keep');
  }
  if (host === 'api.minimax.io') return omittedAnthropic(purpose, 'keep');
  return omittedAnthropic(purpose, 'keep');
}

function openAiChatPolicy(
  host: string,
  model: string,
  purpose: AiRequestPurpose,
): AiRequestPolicy {
  if (host === 'api.deepseek.com') {
    return {
      temperature: samplingTemperature(purpose),
      thinking: DISABLED_THINKING,
      ...probeMaxTokens(purpose, 16),
    };
  }
  if (isBailianChatHost(host)) {
    return {
      temperature: 'keep',
      enableThinking: false,
      ...probeMaxTokens(purpose, 16),
    };
  }
  if (host === 'api.openai.com' && isOfficialReasoningModel(model)) {
    return {
      temperature: 'omit',
      ...(purpose === 'probe' ? { maxCompletionTokens: 256 } : {}),
    };
  }
  return {
    temperature: 'keep',
    ...probeMaxTokens(purpose, 16),
  };
}

function openAiResponsesPolicy(
  host: string,
  model: string,
  purpose: AiRequestPurpose,
): AiRequestPolicy {
  if (host === 'api.deepseek.com') {
    return {
      temperature: 'keep',
      reasoning: { effort: 'none' },
      ...(purpose === 'probe' ? { maxOutputTokens: 16 } : {}),
    };
  }
  if (host === 'api.openai.com' && isOfficialReasoningModel(model)) {
    return {
      temperature: 'omit',
      ...(purpose === 'probe' ? { maxOutputTokens: 256 } : {}),
    };
  }
  return {
    temperature: 'keep',
    ...(purpose === 'probe' ? { maxOutputTokens: 16 } : {}),
  };
}

function geminiPolicy(purpose: AiRequestPurpose): AiRequestPolicy {
  return {
    temperature: 'keep',
    ...(purpose === 'analyze' ? { maxOutputTokens: 4096 } : {}),
    ...(purpose === 'probe' ? { maxOutputTokens: 256 } : {}),
  };
}

function disabledAnthropic(purpose: AiRequestPurpose): AiRequestPolicy {
  return {
    temperature: samplingTemperature(purpose),
    thinking: DISABLED_THINKING,
    ...probeMaxTokens(purpose, 16),
  };
}

function omittedAnthropic(
  purpose: AiRequestPurpose,
  temperature: AiSampling,
): AiRequestPolicy {
  return {
    temperature,
    ...probeMaxTokens(purpose, 256),
  };
}

function samplingTemperature(purpose: AiRequestPurpose): number {
  return purpose === 'analyze' ? 0.2 : 0;
}

function probeMaxTokens(
  purpose: AiRequestPurpose,
  maxTokens: number,
): { maxTokens?: number } {
  return purpose === 'probe' ? { maxTokens } : {};
}

function rejectsDisabledThinking(model: string): boolean {
  return BAILIAN_ANTHROPIC_REJECTS_DISABLED.some((prefix) => hasModelPrefix(model, prefix));
}

function isOfficialReasoningModel(model: string): boolean {
  return OFFICIAL_OPENAI_REASONING_PREFIXES.some((prefix) => hasModelPrefix(model, prefix));
}

function hasModelPrefix(model: string, prefix: string): boolean {
  const id = normalizedModel(model);
  return id.startsWith(prefix.toLowerCase());
}

function normalizedModel(model: string): string {
  const trimmed = model.trim().toLowerCase();
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function requestHostname(baseUrl: string | undefined, apiFormat: AiApiFormat): string {
  const trimmed = baseUrl?.trim();
  const candidate = trimmed ? trimmed : DEFAULT_AI_BASE_URLS[apiFormat];
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
      ? candidate
      : `https://${candidate}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isMaasHost(hostname: string): boolean {
  return hostname === 'maas.aliyuncs.com' || hostname.endsWith('.maas.aliyuncs.com');
}

function isBailianChatHost(hostname: string): boolean {
  return isMaasHost(hostname) || hostname === 'dashscope.aliyuncs.com';
}

function copyRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isDisabledThinking(value: unknown): boolean {
  return isRecord(value) && value.type === 'disabled';
}

function isNoneEffort(value: unknown): boolean {
  return isRecord(value) && value.effort === 'none';
}
