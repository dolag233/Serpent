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
    expect(mcpAccessModeSchema.options).toEqual(['auto', 'full-access']);
    expect(mcpCredentialPermissionSchema.parse({
      credentialId: '00000000-0000-4000-8000-000000000001',
      mode: 'auto',
    })).toEqual({
      credentialId: '00000000-0000-4000-8000-000000000001',
      mode: 'auto',
    });

    const tools = listSerpentMcpTools(readExposure).tools;
    expect(tools.some((tool) => tool.name === 'serpent_tag_create')).toBe(true);
    for (const tool of tools) {
      const descriptor = getAutomationCommandDescriptor(tool.commandId);
      expect(descriptor).toBeDefined();
      expect(tool.requiredCapabilities).toEqual(descriptor?.requiredCapabilities);
    }
    for (const operation of automationCriticalOperationRegistry) {
      expect(tools.some((tool) => tool.name === operation.operation)).toBe(false);
    }

    expect(currentManual).not.toContain('skipApproval');
    expect(currentManual).toContain('Auto');
    expect(currentManual).toContain('Full Access');
    expect(currentManual).toContain('零权限弹窗');
    expect(currentManual).toContain('显式 libraryId');
    expect(readCapabilities).not.toContain('tag.write');
  });
});
