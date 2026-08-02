import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startAutomationMcpHost: vi.fn(),
}));

vi.mock('../../src/main/automation-mcp-host', () => ({
  startAutomationMcpHost: mocks.startAutomationMcpHost,
}));

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

  it('starts unbound when explicitly enabled for headless library creation', async () => {
    mocks.startAutomationMcpHost.mockResolvedValueOnce({
      executionId: 'execution-1',
      sessionId: 'session-1',
      exposure: { writeAccessGranted: false },
      close: vi.fn(),
    });
    const result = await maybeStartAutomationMcpMode({
      journal: {} as never,
      gateway: {} as never,
      request: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn() },
      env: { SERPENT_MCP: '1', SERPENT_MCP_ALLOW_UNBOUND: '1' },
    });

    expect(result?.executionId).toBe('execution-1');
    expect(mocks.startAutomationMcpHost).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: null,
      writeAccessGranted: false,
    }));
  });
});
