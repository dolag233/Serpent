import {
  cliCommandInputSchemas,
  type CliCommandId,
} from '../shared/cli-command-registry';

export interface CliInvocation {
  commandId: CliCommandId;
  input: Record<string, unknown> & { json: boolean; libraryPath?: string };
}

export class CliUsageError extends Error {
  readonly code = 'CLI_USAGE_ERROR';
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliUsageError(`${name} 需要一个值。`);
  }
  args.splice(index, 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const indexes = args
    .map((value, index) => value === name ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length > 1) throw new CliUsageError(`${name} 不能重复。`);
  if (indexes.length === 0) return false;
  args.splice(indexes[0]!, 1);
  return true;
}

function integerOption(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new CliUsageError(`${name} 必须是整数。`);
  return Number(value);
}

export function parseCliArgv(argv: readonly string[]): CliInvocation {
  const args = [...argv];
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    throw new CliUsageError('HELP');
  }
  if (args.includes('-V') || args.includes('--version')) {
    args.splice(args.findIndex((value) => value === '-V' || value === '--version'), 1);
    args.unshift('version');
  }

  const json = takeFlag(args, '--json');
  const libraryPath = takeOption(args, '--library');
  const command = args.shift();
  let commandId: CliCommandId;
  let input: Record<string, unknown>;

  switch (command) {
    case 'version':
      commandId = 'version';
      input = { json };
      break;
    case 'commands':
      if (!json) throw new CliUsageError('commands 需要 --json。');
      commandId = 'commands';
      input = { json: true };
      break;
    case 'health':
      commandId = 'health';
      input = { json, ...(libraryPath ? { libraryPath } : {}) };
      break;
    case 'library':
      if (args.shift() !== 'inspect') throw new CliUsageError('未知的 library 动作。');
      commandId = 'library.inspect';
      input = { json, libraryPath };
      break;
    case 'folder':
      if (args.shift() !== 'list') throw new CliUsageError('未知的 folder 动作。');
      commandId = 'folder.list';
      input = { json, libraryPath };
      break;
    case 'asset': {
      if (args.shift() !== 'list') throw new CliUsageError('未知的 asset 动作。');
      commandId = 'asset.list';
      input = {
        json,
        libraryPath,
        folderRef: takeOption(args, '--folder'),
        recursive: takeFlag(args, '--recursive'),
      };
      break;
    }
    case 'tag':
      if (args.shift() !== 'list') throw new CliUsageError('未知的 tag 动作。');
      commandId = 'tag.list';
      input = { json, libraryPath };
      break;
    case 'collection':
      if (args.shift() !== 'list') throw new CliUsageError('未知的 collection 动作。');
      commandId = 'collection.list';
      input = { json, libraryPath };
      break;
    case 'smart-collection':
      if (args.shift() !== 'list') {
        throw new CliUsageError('未知的 smart-collection 动作。');
      }
      commandId = 'smart-collection.list';
      input = { json, libraryPath };
      break;
    case 'search': {
      const query = args.shift();
      if (query === undefined) throw new CliUsageError('search 需要搜索表达式。');
      commandId = 'search';
      input = {
        json,
        libraryPath,
        query,
        limit: integerOption(takeOption(args, '--limit'), '--limit', 50),
        offset: integerOption(takeOption(args, '--offset'), '--offset', 0),
      };
      break;
    }
    case 'job': {
      if (args.shift() !== 'list') throw new CliUsageError('未知的 job 动作。');
      commandId = 'job.list';
      input = {
        json,
        libraryPath,
        kind: takeOption(args, '--kind') ?? 'all',
      };
      break;
    }
    default:
      throw new CliUsageError(`未知命令：${command ?? ''}`);
  }

  if (args.length > 0) {
    throw new CliUsageError(`无法识别的参数：${args.join(' ')}`);
  }
  const parsed = cliCommandInputSchemas[commandId].safeParse(input);
  if (!parsed.success) {
    if (!libraryPath && commandId !== 'version' && commandId !== 'commands') {
      throw new CliUsageError('此命令需要 --library <资源库根目录>。');
    }
    throw new CliUsageError(parsed.error.issues[0]?.message ?? '参数无效。');
  }
  return { commandId, input: parsed.data };
}

export const CLI_HELP = `Serpent CLI（只读基础层）

用法：
  serpent version [--json]
  serpent commands --json
  serpent [--library <root>] health [--json]
  serpent --library <root> library inspect [--json]
  serpent --library <root> folder list [--json]
  serpent --library <root> asset list [--folder <id|/path>] [--recursive] [--json]
  serpent --library <root> tag list [--json]
  serpent --library <root> collection list [--json]
  serpent --library <root> smart-collection list [--json]
  serpent --library <root> search <expression> [--limit <n>] [--offset <n>] [--json]
  serpent --library <root> job list [--kind all|media|ai] [--json]

资源库内命令必须显式使用 --library；日志不会写入 stdout。`;
