import { describe, expect, it } from 'vitest';

import { buildMcpAgentConnectionText, buildMcpClientConfigText } from '../../src/shared/mcp-client-config';

const ENDPOINT = 'http://127.0.0.1:47342/mcp';
const TOKEN = 'abc123token';

describe('MCP client config formatters (Serpent-8b5b.5)', () => {
  it('renders the generic JSON config with the bearer header', () => {
    const text = buildMcpClientConfigText('generic-json', ENDPOINT, TOKEN);
    const parsed = JSON.parse(text) as {
      mcpServers: { serpent: { type: string; url: string; headers: Record<string, string> } };
    };
    expect(parsed.mcpServers.serpent).toEqual({
      type: 'streamable-http',
      url: ENDPOINT,
      headers: { Authorization: 'Bearer abc123token' },
    });
  });

  it('renders the same mcpServers shape for Claude Code and Cursor', () => {
    for (const format of ['claude', 'cursor'] as const) {
      const parsed = JSON.parse(buildMcpClientConfigText(format, ENDPOINT, TOKEN)) as {
        mcpServers: { serpent: unknown };
      };
      expect(parsed.mcpServers.serpent).toMatchObject({ type: 'streamable-http', url: ENDPOINT });
    }
  });

  it('renders Codex TOML without command/args/cwd', () => {
    const text = buildMcpClientConfigText('codex', ENDPOINT, TOKEN);
    expect(text).toContain('[mcp_servers.serpent]');
    expect(text).toContain(`url = "${ENDPOINT}"`);
    expect(text).toContain('http_headers = { Authorization = "Bearer abc123token" }');
    expect(text).not.toContain('command');
    expect(text).not.toContain('args');
    expect(text).not.toContain('cwd');
  });

  it('renders the plain endpoint-and-token format', () => {
    const text = buildMcpClientConfigText('endpoint-and-token', ENDPOINT, TOKEN);
    expect(text).toBe(`${ENDPOINT}\nAuthorization: Bearer abc123token`);
  });

  it('renders an Agent-ready bundle with authorization and usage rules', () => {
    const text = buildMcpAgentConnectionText('generic-json', ENDPOINT, TOKEN);
    expect(text).toContain(`Endpoint: ${ENDPOINT}`);
    expect(text).toContain(`Authorization: Bearer ${TOKEN}`);
    expect(text).toContain('initialize');
    expect(text).toContain('tools/list');
    expect(text).toContain('explicit libraryId');
    expect(text).toContain('serpent_library_list_open');
    expect(text).toContain('mcpServers');
  });
});
