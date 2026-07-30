import { describe, expect, it, vi } from 'vitest';

import {
  maybeStartAutomationMcpMode,
} from '../../src/main/automation-mcp-bootstrap';

describe('automation MCP bootstrap', () => {
  it('is a no-op when SERPENT_MCP is unset', async () => {
    const result = await maybeStartAutomationMcpMode({
      journal: {} as never,
      gateway: {} as never,
      request: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn() },
      env: {},
    });
    expect(result).toBeNull();
  });

  it('requires an absolute library path in MCP mode', async () => {
    await expect(maybeStartAutomationMcpMode({
      journal: {} as never,
      gateway: {} as never,
      request: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn() },
      env: { SERPENT_MCP: '1' },
    })).rejects.toThrow(/SERPENT_MCP_LIBRARY_PATH/);
  });
});
