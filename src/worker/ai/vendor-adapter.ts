import type { AiAnalysisRequest, AiAnalysisResult } from './protocol';

/**
 * Supported AI vendor identifiers.
 */
export type VendorId = 'dashscope' | 'openai' | 'gemini' | 'anthropic';

/**
 * Discriminated error kind used by every vendor adapter.
 * The caller can decide on retry strategy based on the kind.
 */
export type VendorAdapterErrorKind =
  | 'auth'
  | 'permission'
  | 'quota'
  | 'network'
  | 'rate_limit'
  | 'invalid_response'
  | 'timeout';

/** Sanitized provider metadata retained for diagnostics and retry decisions. */
export interface VendorAdapterErrorDetails {
  httpStatus?: number;
  providerCode?: string;
  providerType?: string;
  providerParam?: string;
  providerMessage?: string;
  requestId?: string;
  responseKind?: string;
  canRetryWithoutStructuredOutput?: boolean;
  formatRejected?: boolean;
}

/**
 * An error raised by a vendor adapter when an AI analysis fails.
 * The `kind` discriminator allows the caller to make retry / fallback
 * decisions without inspecting vendor-specific HTTP bodies.
 */
export class VendorAdapterError extends Error {
  readonly kind: VendorAdapterErrorKind;
  /** Explicitly opt a normally terminal category into bounded queue retry. */
  readonly retryable?: boolean;
  readonly details?: VendorAdapterErrorDetails;

  constructor(
    kind: VendorAdapterErrorKind,
    message: string,
    options?: {
      cause?: unknown;
      retryable?: boolean;
      details?: VendorAdapterErrorDetails;
    },
  ) {
    super(message, options);
    this.name = 'VendorAdapterError';
    this.kind = kind;
    this.retryable = options?.retryable;
    this.details = options?.details;
  }
}

/**
 * Node's AbortSignal.timeout() rejects fetch with TimeoutError, whereas a
 * caller cancellation is normally AbortError. Both must remain retryable AI
 * timeouts rather than being misclassified as an ordinary network failure.
 */
export function isAiAbortOrTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('name' in error)) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Interface every vendor adapter must implement.
 *
 * The adapter is responsible for:
 * - Constructing vendor-specific HTTP requests (auth headers, message shape).
 * - Mapping the `AiAnalysisRequest` into the vendor's vision-message format.
 * - Constraining the vendor to return structured JSON via
 *   response_format / tools / function-calling as appropriate.
 * - Parsing and validating the raw response into an `AiAnalysisResult`.
 * - Translating all HTTP, network and parse errors into `VendorAdapterError`.
 */
export interface VendorAdapter {
  /** Stable vendor identifier. */
  readonly id: VendorId;

  /**
   * Perform an AI analysis.
   *
   * @param request  Asset context and target fields for the analysis.
   * @param signal   Optional AbortSignal for cancellation / timeout.
   * @returns        A validated `AiAnalysisResult`.
   * @throws         `VendorAdapterError` on any failure.
   */
  analyze(
    request: AiAnalysisRequest,
    signal?: AbortSignal,
  ): Promise<AiAnalysisResult>;

  /**
   * Lightweight credential/reachability check. Must not require vision
   * payloads or structured tool_use/json_schema output (test-connection).
   */
  probeConnection(signal?: AbortSignal): Promise<void>;
}
