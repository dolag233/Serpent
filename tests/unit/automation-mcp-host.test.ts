import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSerpentMcpServer: vi.fn(),
  connectSerpentMcpStdio: vi.fn(),
}));

vi.mock('../../src/mcp/create-serpent-mcp-server', () => ({
  createSerpentMcpServer: mocks.createSerpentMcpServer,
  connectSerpentMcpStdio: mocks.connectSerpentMcpStdio,
}));

import { startAutomationMcpHost } from '../../src/main/automation-mcp-host';

type TestLibraryChangedEvent = {
  type: 'library.changed';
  libraryId: string;
  changeSequence: number;
};

function createJournal(libraryId: string | null) {
  const record = {
    executionId: 'execution-1',
    source: 'mcp' as const,
    libraryId,
    status: 'created' as const,
    sessionId: 'session-1',
  };
  return {
    create: vi.fn(() => record),
    start: vi.fn(() => ({ ...record, status: 'running' as const })),
    authorizeFromDesktop: vi.fn(),
    cancel: vi.fn(),
    get: vi.fn(() => record),
  };
}

describe('automation MCP host library.changed push', () => {
  it('emits a filtered MCP logging notification without filesystem paths', async () => {
    const journal = createJournal('library-1');
    const listeners = new Set<(event: TestLibraryChangedEvent) => void>();
    const sendLoggingMessage = vi.fn().mockResolvedValue(undefined);
    const server = { sendLoggingMessage, close: vi.fn().mockResolvedValue(undefined) };
    mocks.createSerpentMcpServer.mockReturnValueOnce(server);
    mocks.connectSerpentMcpStdio.mockResolvedValueOnce({});

    const handle = await startAutomationMcpHost({
      journal: journal as never,
      gateway: {} as never,
      libraryId: 'library-1',
      onLibraryChanged: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });

    for (const listener of listeners) {
      listener({ type: 'library.changed', libraryId: 'library-1', changeSequence: 42 });
    }
    await Promise.resolve();

    expect(sendLoggingMessage).toHaveBeenCalledWith({
      level: 'info',
      logger: 'serpent.library',
      data: {
        type: 'library.changed',
        libraryId: 'library-1',
        changeSequence: 42,
      },
    });
    expect(JSON.stringify(sendLoggingMessage.mock.calls)).not.toContain('path');

    await handle.close();
    expect(listeners).toHaveLength(0);
  });

  it('does not notify for unbound or unrelated libraries', async () => {
    const journal = createJournal(null);
    const listeners = new Set<(event: TestLibraryChangedEvent) => void>();
    const sendLoggingMessage = vi.fn().mockResolvedValue(undefined);
    const server = { sendLoggingMessage, close: vi.fn().mockResolvedValue(undefined) };
    mocks.createSerpentMcpServer.mockReturnValueOnce(server);
    mocks.connectSerpentMcpStdio.mockResolvedValueOnce({});

    const handle = await startAutomationMcpHost({
      journal: journal as never,
      gateway: {} as never,
      libraryId: null,
      onLibraryChanged: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });

    for (const listener of listeners) {
      listener({ type: 'library.changed', libraryId: 'library-1', changeSequence: 1 });
    }
    expect(sendLoggingMessage).not.toHaveBeenCalled();

    journal.get.mockReturnValueOnce({ ...journal.get(), libraryId: 'library-2' });
    for (const listener of listeners) {
      listener({ type: 'library.changed', libraryId: 'library-1', changeSequence: 2 });
    }
    expect(sendLoggingMessage).not.toHaveBeenCalled();

    await handle.close();
  });

  it('cancels the Main-owned execution if stdio transport setup fails', async () => {
    const journal = createJournal('library-1');
    const server = { sendLoggingMessage: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    mocks.createSerpentMcpServer.mockReturnValueOnce(server);
    mocks.connectSerpentMcpStdio.mockRejectedValueOnce(new Error('stdio unavailable'));

    await expect(startAutomationMcpHost({
      journal: journal as never,
      gateway: {} as never,
      libraryId: 'library-1',
    })).rejects.toThrow('stdio unavailable');
    expect(journal.cancel).toHaveBeenCalledWith('execution-1');
  });
});
