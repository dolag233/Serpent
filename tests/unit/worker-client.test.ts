import { describe, expect, it } from 'vitest';

import { requestTimeoutForCommand } from '../../src/main/worker-client';

describe('requestTimeoutForCommand', () => {
  it('allows browser capture to finish its bounded download before Main times out', () => {
    expect(requestTimeoutForCommand('extension.save-from-url')).toBe(5 * 60_000);
  });

  it('keeps ordinary requests on the short timeout', () => {
    expect(requestTimeoutForCommand('asset.list')).toBe(15_000);
  });
});
