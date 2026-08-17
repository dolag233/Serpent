import type {
  AiProvider,
  ProviderConcurrencyLimiter,
} from './provider-concurrency-limiter';

/**
 * Wait for the process-wide AI slot using only the caller's cancellation
 * signal. The per-request timeout starts only after a real outbound request
 * owns that slot, so a busy batch cannot turn queueing time into false
 * provider timeouts.
 */
export async function runLimitedAiRequest<T>(
  limiter: ProviderConcurrencyLimiter,
  provider: AiProvider,
  cancellationSignal: AbortSignal | undefined,
  requestTimeoutMs: number,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return limiter.run(provider, cancellationSignal, () => {
    const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
    const requestSignal = cancellationSignal
      ? AbortSignal.any([cancellationSignal, timeoutSignal])
      : timeoutSignal;
    return request(requestSignal);
  });
}
