import type { PublicErrorReason } from '../../shared/protocol/errors';
import { VendorAdapterError, type VendorAdapterErrorKind } from './vendor-adapter';

const REASON_BY_KIND: Record<VendorAdapterErrorKind, PublicErrorReason> = {
  auth: 'AI_AUTH',
  permission: 'AI_PERMISSION',
  quota: 'AI_QUOTA',
  rate_limit: 'AI_RATE_LIMIT',
  network: 'AI_NETWORK',
  timeout: 'AI_TIMEOUT',
  invalid_response: 'AI_INVALID_RESPONSE',
};

export function vendorFailure(error: VendorAdapterError): {
  errorCode: string;
  reason: PublicErrorReason;
  retryable: boolean;
} {
  return {
    errorCode: `AI_${error.kind.toUpperCase()}`,
    reason: REASON_BY_KIND[error.kind],
    retryable: error.kind === 'network' || error.kind === 'timeout' || error.kind === 'rate_limit',
  };
}

export function findVendorError(error: unknown): VendorAdapterError | undefined {
  const visited = new Set<unknown>();
  let current = error;
  while (typeof current === 'object' && current !== null && !visited.has(current)) {
    visited.add(current);
    if (current instanceof VendorAdapterError) return current;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/([?&](?:key|api[_-]?key|token|access[_-]?token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, 'sk-[redacted]')
    .replace(/\bAIza[A-Za-z0-9_-]+\b/g, 'AIza[redacted]');
}

function diagnosticCause(error: unknown, depth = 0): Error | undefined {
  if (!(error instanceof Error) || depth >= 3) return undefined;
  const systemCode = 'code' in error && typeof error.code === 'string'
    ? ` code=${redactDiagnosticText(error.code)}`
    : '';
  const detail = `${error.name}${systemCode}: ${redactDiagnosticText(error.message)}`;
  return new Error(detail, { cause: diagnosticCause(error.cause, depth + 1) });
}

export function safeAiDiagnostic(errorCode: string, source?: unknown): Error {
  const vendorError = findVendorError(source);
  const httpStatus = vendorError?.message.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
  const summary = [
    `Provider failure category: ${errorCode}`,
    vendorError ? `kind=${vendorError.kind}` : undefined,
    httpStatus ? `httpStatus=${httpStatus}` : undefined,
  ].filter((part): part is string => part !== undefined).join('; ');
  return new Error('AI queue analysis failed.', {
    cause: new Error(summary, { cause: diagnosticCause(vendorError?.cause ?? source) }),
  });
}
