import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  automationCriticalOperationRegistry,
  getAutomationCommandDescriptor,
} from '../../src/automation/command-registry';
import { listSerpentMcpTools } from '../../src/mcp/tool-catalog';
import { mcpAccessModeSchema, mcpCredentialPermissionSchema } from '../../src/shared/mcp';
import { readCapabilities, readExposure } from './serpent-mcp-test-fixtures';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const currentManual = [
  readFileSync(path.join(repositoryRoot, 'docs/manual/mcp/api-reference.md'), 'utf8'),
  readFileSync(path.join(repositoryRoot, 'docs/manual/mcp/development.md'), 'utf8'),
].join('\n');

describe('MCP permission contract', () => {
  it('keeps the Registry, tools/list projection and manual on the same model', () => {
    expect(mcpAccessModeSchema.options).toEqual(['read-only', 'read-write', 'full-access']);
    expect(mcpCredentialPermissionSchema.parse({
      credentialId: '00000000-0000-4000-8000-000000000001',
      mode: 'read-write',
    })).toEqual({
      credentialId: '00000000-0000-4000-8000-000000000001',
      mode: 'read-write',
    });

    const tools = listSerpentMcpTools(readExposure).tools;
    expect(tools.some((tool) => tool.name === 'serpent_tag_create')).toBe(true);
    for (const tool of tools) {
      const descriptor = getAutomationCommandDescriptor(tool.commandId);
      expect(descriptor).toBeDefined();
      expect(tool.requiredCapabilities).toEqual(descriptor?.requiredCapabilities);
    }
    // Serpent-8b5b.2: dangerous operations are exposed only through the
    // two-phase challenge — exactly one critical tool exists, gated by the
    // challenge confirmation fields, and no other critical operation leaks.
    const dangerousTool = tools.find((tool) => tool.commandId === 'asset.delete-permanent');
    expect(dangerousTool).toBeDefined();
    expect(dangerousTool?.riskTier).toBe('critical');
    expect(dangerousTool?.annotations.destructiveHint).toBe(true);
    expect(dangerousTool?.requiresCriticalConfirmation).toBe(true);
    expect(dangerousTool?.description).toContain('approval=agent-challenge');
    expect(dangerousTool?.inputSchema).toMatchObject({
      properties: expect.objectContaining({
        challengeId: expect.anything(),
        acknowledged: expect.anything(),
      }),
    });
    for (const operation of automationCriticalOperationRegistry) {
      if ((operation.operation as string) === 'asset.delete-permanent'
        || (operation.operation as string) === 'library.delete-from-disk') continue;
      expect(tools.some((tool) => tool.commandId === operation.operation)).toBe(false);
    }

    expect(currentManual).not.toContain('skipApproval');
    expect(currentManual).toContain('只读');
    expect(currentManual).toContain('读写');
    expect(currentManual).toContain('完全');
    expect(currentManual).toContain('Read-only');
    expect(currentManual).toContain('显式 libraryId');
    expect(readCapabilities).not.toContain('tag.write');
  });
});
