import type { McpConfigFormat } from './mcp';

/**
 * Pure client-config formatters (Serpent-8b5b.5). One canonical connection
 * description is rendered for each supported client; the config never
 * contains command/args/cwd/Node paths (ADR-0029 §8).
 */

export function buildMcpClientConfigText(
  format: McpConfigFormat,
  endpoint: string,
  token: string,
): string {
  const authorization = `Bearer ${token}`;
  switch (format) {
    case 'generic-json':
    case 'claude':
    case 'cursor':
      return JSON.stringify({
        mcpServers: {
          serpent: {
            type: 'streamable-http',
            url: endpoint,
            headers: { Authorization: authorization },
          },
        },
      }, null, 2);
    case 'codex':
      return [
        '[mcp_servers.serpent]',
        `url = "${endpoint}"`,
        `http_headers = { Authorization = "${authorization}" }`,
        '',
      ].join('\n');
    case 'endpoint-and-token':
      return `${endpoint}\nAuthorization: ${authorization}`;
  }
}
