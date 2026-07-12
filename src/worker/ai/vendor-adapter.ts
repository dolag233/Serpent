import type { AiAnalysisRequest, AiAnalysisResult } from './protocol';

/**
 * Supported AI vendor identifiers.
 */
export type VendorId = 'openai' | 'gemini' | 'anthropic';

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

/**
 * An error raised by a vendor adapter when an AI analysis fails.
 * The `kind` discriminator allows the caller to make retry / fallback
 * decisions without inspecting vendor-specific HTTP bodies.
 */
export class VendorAdapterError extends Error {
  readonly kind: VendorAdapterErrorKind;

  constructor(
    kind: VendorAdapterErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'VendorAdapterError';
    this.kind = kind;
  }
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
}
