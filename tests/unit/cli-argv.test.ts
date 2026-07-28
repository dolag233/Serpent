import { describe, expect, it } from 'vitest';

import { CliUsageError, parseCliArgv } from '../../src/cli/argv';
import { describeCliCommands } from '../../src/shared/cli-command-registry';
import {
  ResourceReferenceError,
  resolveFolderReference,
} from '../../src/shared/resource-reference';

describe('Serpent CLI argv contract', () => {
  it('requires an explicit library for library-scoped commands', () => {
    expect(() => parseCliArgv(['asset', 'list'])).toThrowError(CliUsageError);
    expect(() => parseCliArgv(['search', 'poster'])).toThrow(
      '此命令需要 --library <资源库根目录>。',
    );
  });

  it('parses global and command options independent of their position', () => {
    expect(parseCliArgv([
      'asset',
      'list',
      '--recursive',
      '--library',
      '/Volumes/Art Library',
      '--folder',
      'folder-id',
      '--json',
    ])).toEqual({
      commandId: 'asset.list',
      input: {
        json: true,
        libraryPath: '/Volumes/Art Library',
        folderRef: 'folder-id',
        recursive: true,
      },
    });
  });

  it('rejects unknown, duplicate, and malformed options', () => {
    expect(() => parseCliArgv(['version', '--json', '--json'])).toThrow(
      '--json 不能重复。',
    );
    expect(() => parseCliArgv([
      '--library',
      '/tmp/library',
      'search',
      'poster',
      '--limit',
      'many',
    ])).toThrow('--limit 必须是整数。');
    expect(() => parseCliArgv(['version', '--wat'])).toThrow(
      '无法识别的参数：--wat',
    );
  });

  it('publishes stable machine-readable command descriptions', () => {
    const description = describeCliCommands() as {
      schemaVersion: number;
      commands: Array<{
        commandId: string;
        mutatesLibrary: boolean;
        inputSchema: { type?: string };
      }>;
    };
    expect(description.schemaVersion).toBe(1);
    expect(description.commands.map((command) => command.commandId)).toContain('search');
    expect(description.commands.every((command) => !command.mutatesLibrary)).toBe(true);
    expect(description.commands.every((command) => command.inputSchema.type === 'object'))
      .toBe(true);
  });

  it('resolves only stable IDs or canonical managed folder paths', () => {
    const managed = [{
      folderId: 'folder-id',
      parentFolderId: null,
      name: 'Stone',
      relativePath: 'Textures/Stone',
      directAssetCount: 2,
      childFolderCount: 0,
    }];
    expect(resolveFolderReference('folder-id', managed, [])).toBe('folder-id');
    expect(resolveFolderReference('/Textures/Stone', managed, [])).toBe('folder-id');
    expect(() => resolveFolderReference('Stone', managed, []))
      .toThrowError(ResourceReferenceError);
  });
});
