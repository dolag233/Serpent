export const MEDIA_RESOURCE_EXHAUSTED_ERROR_CODE = 'MEDIA_RESOURCE_EXHAUSTED';

const RESOURCE_ERROR_PATTERN = /(?:cannot allocate memory|out of memory|not enough memory|memory allocation failed|could not allocate|get_buffer\(\) failed|thread_get_buffer\(\) failed|error submitting packet[^\n]*memory|stack overflow|dll initialization failed)/iu;
const PROCESS_START_PRESSURE_PATTERN = /spawn\s+enomem|0xc0000017|0xc000009a|0xc0000142|0xc00000fd|3221225495|3221225626|3221225794|3221225725/iu;

export interface MediaResourceFailureLike {
  code?: unknown;
  errno?: unknown;
  exitCode?: unknown;
  message?: unknown;
  stderr?: unknown;
  cause?: unknown;
}

function failureText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (typeof error !== 'object' || error === null) return '';
  const candidate = error as MediaResourceFailureLike;
  const fields = [candidate.message, candidate.stderr, candidate.code, candidate.errno, candidate.exitCode]
    .filter((field): field is string | number => typeof field === 'string' || typeof field === 'number')
    .map(String);
  if (candidate.cause !== undefined) fields.push(failureText(candidate.cause));
  return fields.join(' ');
}

/**
 * Detect native/process resource pressure without treating ordinary codec or
 * binary/input errors as memory failures. In particular, Windows' generic
 * `spawn UNKNOWN` is intentionally not enough: the incident logs contain
 * that code for unsupported OIIO inputs as well as for process pressure.
 * Concrete ENOMEM/status codes or allocator text are required.
 */
export function isMediaResourceExhaustion(error: unknown): boolean {
  if (typeof error === 'string') {
    return RESOURCE_ERROR_PATTERN.test(error) || PROCESS_START_PRESSURE_PATTERN.test(error);
  }
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as MediaResourceFailureLike;
  const code = typeof candidate.code === 'string' ? candidate.code.toUpperCase() : '';
  const errno = typeof candidate.errno === 'string' ? candidate.errno.toUpperCase() : '';
  if (code === 'ENOMEM' || errno === 'ENOMEM') return true;
  const text = failureText(error);
  return RESOURCE_ERROR_PATTERN.test(text) || PROCESS_START_PRESSURE_PATTERN.test(text);
}

export function mediaResourceFailureFromSpawnResult(result: {
  exitCode: number;
  stderr: string;
}): boolean {
  return isMediaResourceExhaustion(result);
}

export class MediaResourceExhaustedError extends Error {
  readonly code = MEDIA_RESOURCE_EXHAUSTED_ERROR_CODE;

  constructor(
    message: string,
    readonly operation: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MediaResourceExhaustedError';
  }
}

export function asMediaResourceExhaustedError(
  error: unknown,
  operation: string,
): MediaResourceExhaustedError | undefined {
  if (error instanceof MediaResourceExhaustedError) return error;
  if (!isMediaResourceExhaustion(error)) return undefined;
  return new MediaResourceExhaustedError(
    `${operation} stopped because the operating system reported media resource pressure.`,
    operation,
    error,
  );
}

/** Process-wide backoff shared by every open library in one Worker. */
export class MediaResourceGuard {
  private blockedUntilMs = 0;
  private consecutiveFailures = 0;
  private externalHolds = 0;

  constructor(
    private readonly baseCooldownMs = 30_000,
    private readonly maxCooldownMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  isCoolingDown(): boolean {
    return this.externalHolds > 0 || this.now() < this.blockedUntilMs;
  }

  remainingMs(): number {
    return Math.max(0, this.blockedUntilMs - this.now());
  }

  recordFailure(): number {
    this.consecutiveFailures += 1;
    const cooldown = Math.min(
      this.maxCooldownMs,
      this.baseCooldownMs * (2 ** Math.min(4, this.consecutiveFailures - 1)),
    );
    this.blockedUntilMs = Math.max(this.blockedUntilMs, this.now() + cooldown);
    return cooldown;
  }

  recordHealthyCompletion(): void {
    if (!this.isCoolingDown()) this.consecutiveFailures = 0;
  }

  /**
   * Temporarily stop claiming new native media work while a synchronous
   * filesystem import is running in this Worker. Existing decoders are left
   * alone and are already bounded by the per-lane semaphores; this avoids
   * changing user-visible job state just to protect the import critical path.
   */
  enterExternalHold(): void {
    this.externalHolds += 1;
  }

  exitExternalHold(): void {
    this.externalHolds = Math.max(0, this.externalHolds - 1);
  }

  hasExternalHold(): boolean {
    return this.externalHolds > 0;
  }

  /** Test seam; production state is intentionally process-wide. */
  reset(): void {
    this.blockedUntilMs = 0;
    this.consecutiveFailures = 0;
    this.externalHolds = 0;
  }
}

export const mediaResourceGuard = new MediaResourceGuard();
