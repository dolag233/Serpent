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

/**
 * Human/Agent-facing connection bundle. The client config alone is useful for
 * a config file, but an Agent also needs to know how to discover tools and
 * target a library. Keep the token in the copied text because the user is
 * explicitly handing this bundle to a trusted local Agent.
 */
export function buildMcpAgentConnectionText(
  format: McpConfigFormat,
  endpoint: string,
  token: string,
): string {
  const config = buildMcpClientConfigText(format, endpoint, token);
  return [
    'Serpent MCP connection',
    '',
    `Endpoint: ${endpoint}`,
    'Transport: Streamable HTTP',
    `Authorization: Bearer ${token}`,
    '',
    'Client configuration:',
    '```',
    config,
    '```',
    '',
    'Agent instructions:',
    '- Connect with Streamable HTTP and call initialize, then tools/list.',
    '- Call serpent_library_list_open or serpent_library_list_recent to find a libraryId.',
    '- Include that explicit libraryId in every library-scoped tool call; do not assume the desktop focus library is the target.',
    '- Critical operations return an exact challenge and require a second confirmation call.',
    '- Keep this Bearer token secret. Revoke the client in Serpent settings when it is no longer trusted.',
  ].join('\n');
}
