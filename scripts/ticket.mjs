import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const STATUSES = new Set(['open', 'in_progress', 'closed', 'deferred']);
const TYPES = new Set(['bug', 'feature', 'task', 'epic', 'chore']);
const ALIASES = new Map([
  ['-a', 'assignee'],
  ['-d', 'body'],
  ['-l', 'labels'],
  ['-p', 'priority'],
  ['-t', 'type'],
]);
const BOOLEAN_OPTIONS = new Set(['all', 'force', 'help', 'ids-only', 'json', 'stdin']);
const VALUE_OPTIONS = new Set([
  'assignee',
  'body',
  'blocked-by',
  'description',
  'file',
  'fields',
  'id',
  'label',
  'labels',
  'prefix',
  'priority',
  'reason',
  'root',
  'status',
  'text',
  'title',
  'type',
]);

class TicketError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'TicketError';
    this.exitCode = exitCode;
  }
}

export { readIssues, writeIssues, issuesPath, TicketError };

function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    const rawName = ALIASES.get(token) ?? token.replace(/^--/, '');
    if (!token.startsWith('--') && !ALIASES.has(token)) {
      positionals.push(token);
      continue;
    }
    const equalIndex = rawName.indexOf('=');
    if (equalIndex !== -1) {
      options[rawName.slice(0, equalIndex)] = rawName.slice(equalIndex + 1);
      continue;
    }
    if (BOOLEAN_OPTIONS.has(rawName)) {
      options[rawName] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(rawName)) throw new TicketError(`未知选项：${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TicketError(`选项 ${token} 需要一个值`);
    }
    index += 1;
    if (options[rawName] === undefined) options[rawName] = value;
    else if (Array.isArray(options[rawName])) options[rawName].push(value);
    else options[rawName] = [options[rawName], value];
  }
  return { positionals, options };
}

function values(options, ...keys) {
  return keys
    .flatMap((key) => {
      const value = options[key];
      return value === undefined ? [] : Array.isArray(value) ? value : [value];
    })
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function rootFrom(options) {
  return path.resolve(options.root ?? process.cwd());
}

function issuesPath(root) {
  return path.join(root, '.beads', 'issues.jsonl');
}

function now() {
  return new Date().toISOString();
}

function actor() {
  try {
    const name = execFileSync('git', ['config', 'user.name'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (name) return name;
  } catch {
    // Use the platform identity below.
  }
  return process.env.USERNAME || process.env.USER || 'unknown';
}

function readIssues(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line)
    .map(({ line, number }) => {
      try {
        const issue = JSON.parse(line);
        if (issue._type !== 'issue' || typeof issue.id !== 'string') {
          throw new Error('不是 issue 记录');
        }
        return issue;
      } catch (error) {
        throw new TicketError(`无法解析工单 JSONL 第 ${number} 行：${error.message}`);
      }
    });
}

function writeIssues(filePath, issues) {
  if (issues.length === 0 && fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8').trim();
    if (existing) {
      throw new TicketError(
        '拒绝将工单文件写成空：当前 .beads/issues.jsonl 仍有内容。'
        + '若本地 Dolt 与 JSONL 脱节，勿运行 bd export；用 npm run ticket 维护工单。',
        2,
      );
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = issues.length
    ? `${issues.map((issue) => JSON.stringify(issue)).join('\n')}\n`
    : '';
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporaryPath, content, 'utf8');
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function withWriteLock(filePath, callback) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new TicketError('工单文件正在被另一个命令修改，请稍后重试。', 2);
    }
    throw error;
  }
  try {
    return callback();
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lockPath, { force: true });
  }
}

function validateStatus(status) {
  if (!STATUSES.has(status)) {
    throw new TicketError(`status 必须是 ${[...STATUSES].join('|')} 之一`);
  }
}

function validateType(type) {
  if (!TYPES.has(type)) {
    throw new TicketError(`type 必须是 ${[...TYPES].join('|')} 之一`);
  }
}

function priorityOf(issue) {
  const priority = Number(issue.priority ?? 2);
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
    throw new TicketError(`工单 ${issue.id} 的 priority 必须是 0–4`);
  }
  return priority;
}

function resolveIssue(issues, id) {
  const exact = issues.filter((issue) => issue.id === id);
  if (exact.length === 1) return exact[0];
  const normalized = id.toLowerCase();
  const partial = issues.filter(
    (issue) => issue.id.toLowerCase() === normalized
      || issue.id.toLowerCase().endsWith(`-${normalized}`),
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new TicketError(`工单 ID 不唯一：${id}（${partial.map((issue) => issue.id).join(', ')}）`);
  }
  throw new TicketError(`找不到工单：${id}`);
}

function dependencyIds(issue) {
  if (Array.isArray(issue.blocked_by)) return issue.blocked_by.map(String);
  if (!Array.isArray(issue.dependencies)) return [];
  return issue.dependencies
    .map((dependency) => dependency?.depends_on_id)
    .filter(Boolean)
    .map(String);
}

function addDependency(issue, blockerId, createdBy) {
  const dependencies = Array.isArray(issue.dependencies) ? issue.dependencies : [];
  if (dependencies.some((dependency) => dependency?.depends_on_id === blockerId)) return;
  dependencies.push({
    issue_id: issue.id,
    depends_on_id: blockerId,
    type: 'blocks',
    created_at: now(),
    created_by: createdBy,
    metadata: '{}',
  });
  issue.dependencies = dependencies;
  if (Array.isArray(issue.blocked_by)) {
    issue.blocked_by = [...new Set([...issue.blocked_by, blockerId])];
  }
}

function removeDependency(issue, blockerId) {
  if (Array.isArray(issue.dependencies)) {
    issue.dependencies = issue.dependencies.filter(
      (dependency) => dependency?.depends_on_id !== blockerId,
    );
  }
  if (Array.isArray(issue.blocked_by)) {
    issue.blocked_by = issue.blocked_by.filter((id) => id !== blockerId);
  }
}

function generateId(issues, prefix) {
  const existing = new Set(issues.map((issue) => issue.id));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = `${prefix}-${crypto.randomBytes(3).toString('hex')}`;
    if (!existing.has(id)) return id;
  }
  throw new TicketError('无法生成不重复的工单 ID，请稍后重试。');
}

function requirePositionals(positionals, count, usage) {
  if (positionals.length < count) throw new TicketError(`参数不足。用法：${usage}`);
}

function commandAdd(issues, positionals, options) {
  const title = options.title ?? positionals.join(' ');
  if (!title) throw new TicketError('添加工单需要标题。');
  const priority = Number(options.priority ?? 2);
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
    throw new TicketError('priority 必须是 0–4');
  }
  const type = String(options.type ?? 'task');
  validateType(type);
  const prefix = String(options.prefix ?? 'Serpent').replace(/[^A-Za-z0-9_-]/g, '');
  if (!prefix) throw new TicketError('prefix 不能为空。');
  const timestamp = now();
  const createdBy = actor();
  const issue = {
    _type: 'issue',
    id: options.id ?? generateId(issues, prefix),
    title,
    description: String(options.body ?? options.description ?? ''),
    status: 'open',
    priority,
    issue_type: type,
    assignee: options.assignee ?? '',
    created_at: timestamp,
    created_by: createdBy,
    updated_at: timestamp,
    labels: values(options, 'labels', 'label'),
    dependencies: [],
    comments: [],
  };
  for (const blockerId of values(options, 'blocked-by')) {
    const blocker = resolveIssue(issues, blockerId);
    addDependency(issue, blocker.id, createdBy);
  }
  issues.push(issue);
  return issue;
}

function commandDescription(issues, positionals, options) {
  requirePositionals(positionals, 1, 'ticket desc <id> --body <文本>');
  const issue = resolveIssue(issues, positionals[0]);
  if (options.body !== undefined) issue.description = String(options.body);
  else if (options.description !== undefined) issue.description = String(options.description);
  else if (options.file !== undefined) {
    issue.description = fs.readFileSync(path.resolve(String(options.file)), 'utf8');
  } else if (options.stdin) issue.description = fs.readFileSync(0, 'utf8');
  else throw new TicketError('修改描述需要 --body、--file 或 --stdin。');
  issue.updated_at = now();
  return issue;
}

function appendComment(issue, text, author = actor()) {
  const comment = {
    id: crypto.randomUUID(),
    issue_id: issue.id,
    author,
    text,
    created_at: now(),
  };
  issue.comments = Array.isArray(issue.comments) ? [...issue.comments, comment] : [comment];
  issue.updated_at = comment.created_at;
  return comment;
}

function commandComment(issues, positionals, options) {
  requirePositionals(positionals, 1, 'ticket comment <id> --text <文本>');
  const text = String(options.text ?? '').trim();
  if (!text) throw new TicketError('添加评论需要非空的 --text。');
  const issue = resolveIssue(issues, positionals[0]);
  appendComment(issue, text);
  return issue;
}

function commandStatus(issues, positionals, options) {
  requirePositionals(positionals, 2, 'ticket status <id> <状态>');
  const issue = resolveIssue(issues, positionals[0]);
  const status = positionals[1];
  validateStatus(status);
  const reopening = issue.status === 'closed' && (status === 'open' || status === 'in_progress');
  const reason = String(options.reason ?? '').trim();
  if (reopening && !reason) {
    throw new TicketError('关闭的工单重新打开时必须提供非空的 --reason。');
  }
  issue.status = status;
  issue.updated_at = now();
  if (status === 'closed') {
    issue.closed_at = now();
    if (options.reason !== undefined) issue.close_reason = String(options.reason);
  } else {
    delete issue.closed_at;
    delete issue.close_reason;
    if (reopening) appendComment(issue, `重新打开：${reason}`);
  }
  return issue;
}

function commandPriority(issues, positionals) {
  requirePositionals(positionals, 2, 'ticket priority <id> <0..4>');
  const issue = resolveIssue(issues, positionals[0]);
  const priority = Number(positionals[1]);
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
    throw new TicketError('priority 必须是 0–4');
  }
  issue.priority = priority;
  if (Array.isArray(issue.labels)) {
    issue.labels = issue.labels.map((label) => (
      /^p[0-4]$/i.test(String(label)) ? `p${priority}` : label
    ));
  }
  issue.updated_at = now();
  return issue;
}

function commandClaim(issues, positionals, options) {
  requirePositionals(positionals, 1, 'ticket claim <id> [--assignee <名称>]');
  const issue = resolveIssue(issues, positionals[0]);
  const assignee = String(options.assignee ?? actor());
  if (issue.assignee && String(issue.assignee).trim() && issue.assignee !== assignee) {
    throw new TicketError(`工单已由 ${issue.assignee} 认领，不能由 ${assignee} 抢占。`, 2);
  }
  issue.assignee = assignee;
  issue.status = 'in_progress';
  issue.updated_at = now();
  return issue;
}

function commandDependency(issues, positionals) {
  requirePositionals(positionals, 3, 'ticket dep add|remove <工单> <阻塞工单>');
  const [action, targetId, blockerId] = positionals;
  if (action !== 'add' && action !== 'remove') {
    throw new TicketError('依赖操作必须是 add 或 remove。');
  }
  const target = resolveIssue(issues, targetId);
  const blocker = resolveIssue(issues, blockerId);
  if (target.id === blocker.id) throw new TicketError('工单不能依赖自己。');
  if (action === 'add') addDependency(target, blocker.id, actor());
  else removeDependency(target, blocker.id);
  target.updated_at = now();
  return target;
}

function commandDelete(issues, positionals, options) {
  requirePositionals(positionals, 1, 'ticket delete <id> [--force]');
  const issue = resolveIssue(issues, positionals[0]);
  const dependents = issues.filter((candidate) => dependencyIds(candidate).includes(issue.id));
  if (dependents.length && !options.force) {
    throw new TicketError(
      `工单仍被 ${dependents.map((candidate) => candidate.id).join(', ')} 依赖；如确认删除，请使用 --force。`,
      2,
    );
  }
  if (options.force) {
    for (const dependent of dependents) {
      removeDependency(dependent, issue.id);
      dependent.updated_at = now();
    }
  }
  issues.splice(issues.indexOf(issue), 1);
  return issue;
}

function sorted(issues) {
  return [...issues].sort(
    (left, right) => priorityOf(left) - priorityOf(right)
      || String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')),
  );
}

function commandList(issues, options) {
  let result = issues;
  if (options.status) {
    validateStatus(String(options.status));
    result = result.filter((issue) => issue.status === options.status);
  }
  if (options.priority !== undefined) {
    const priority = Number(options.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
      throw new TicketError('priority 必须是 0–4');
    }
    result = result.filter((issue) => priorityOf(issue) === priority);
  }
  if (options.assignee) result = result.filter((issue) => issue.assignee === options.assignee);
  const labels = values(options, 'labels', 'label');
  if (labels.length) {
    result = result.filter((issue) => labels.every((label) => issue.labels?.includes(label)));
  }
  return sorted(result);
}

function commandReady(issues) {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  return sorted(issues)
    .filter((issue) => issue.status === 'open')
    .filter((issue) => dependencyIds(issue).every((id) => byId.get(id)?.status === 'closed'));
}

function listOutput(value, options, json) {
  if (!Array.isArray(value)) return value;
  if (options['ids-only']) return value.map((issue) => issue.id);
  if (json && options.fields !== undefined) {
    const fields = values(options, 'fields');
    if (!fields.length) throw new TicketError('--fields 需要至少一个字段名。');
    return value.map((issue) => Object.fromEntries(
      fields.map((field) => [field, issue[field]]),
    ));
  }
  return value;
}

function print(value, json, options = {}) {
  const output = listOutput(value, options, json);
  if (json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  if (Array.isArray(output)) {
    for (const issue of output) {
      if (typeof issue === 'string') {
        process.stdout.write(`${issue}\n`);
        continue;
      }
      process.stdout.write(`${issue.id} [P${priorityOf(issue)}] ${issue.status} ${issue.title}\n`);
    }
    return;
  }
  process.stdout.write(`${output.id} [P${priorityOf(output)}] ${output.status} ${output.title}\n`);
  if (output.description) process.stdout.write(`\n${output.description}\n`);
}

function usage() {
  return `用法：
  ticket add <标题> [-d <描述>] [-p 0..4] [-t bug|feature|task|epic|chore]
  ticket show <id> [--json]
  ticket list [--status <状态>] [--priority <0..4>] [--label <标签>] [--all]
    [--ids-only] [--fields <字段1,字段2>] [--json]
  ticket ready [--json]
  ticket desc <id> --body <文本> | --file <文件> | --stdin
  ticket comment <id> --text <文本>
  ticket status <id> <open|in_progress|closed|deferred> [--reason <原因>]
  ticket priority <id> <0..4>
  ticket claim <id> [--assignee <名称>]
  ticket dep add|remove <id> <阻塞工单>
  ticket delete <id> [--force]

默认只读写 .beads/issues.jsonl；所有命令支持 --root <项目目录>。
脚本只修改文本工单，不执行 git commit/push，也不启动后台进程。`;
}

export function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { positionals, options } = parseArgs(rest);
  const root = rootFrom(options);
  const filePath = issuesPath(root);
  let result;

  if (command === 'add') {
    result = withWriteLock(filePath, () => {
      const issues = readIssues(filePath);
      const issue = commandAdd(issues, positionals, options);
      writeIssues(filePath, issues);
      return issue;
    });
  } else if (command === 'desc' || command === 'description') {
    result = withWriteLock(filePath, () => {
      const issues = readIssues(filePath);
      const issue = commandDescription(issues, positionals, options);
      writeIssues(filePath, issues);
      return issue;
    });
  } else if (command === 'comment') {
    result = withWriteLock(filePath, () => {
      const issues = readIssues(filePath);
      const issue = commandComment(issues, positionals, options);
      writeIssues(filePath, issues);
      return issue;
    });
  } else if (command === 'status' || command === 'close') {
    result = withWriteLock(filePath, () => {
      const issues = readIssues(filePath);
      const statusArgs = command === 'close' ? [positionals[0], 'closed'] : positionals;
      const issue = commandStatus(issues, statusArgs, options);
      writeIssues(filePath, issues);
      return issue;
    });
  } else if (command === 'priority') {
    result = withWriteLock(filePath, () => {
      const issues = readIssues(filePath);
      const issue = commandPriority(issues, positionals);
      writeIssues(filePath, issues);
      return issue;
    });
  } else if (command === 'claim') {
    result = withWriteLock(filePath, () => {
      const issues = readIssues(filePath);
      const issue = commandClaim(issues, positionals, options);
      writeIssues(filePath, issues);
      return issue;
    });
  } else if (command === 'dep') {
    result = withWriteLock(filePath, () => {
      const issues = readIssues(filePath);
      const issue = commandDependency(issues, positionals);
      writeIssues(filePath, issues);
      return issue;
    });
  } else if (command === 'delete' || command === 'rm') {
    result = withWriteLock(filePath, () => {
      const issues = readIssues(filePath);
      const issue = commandDelete(issues, positionals, options);
      writeIssues(filePath, issues);
      return issue;
    });
  } else if (command === 'show') {
    requirePositionals(positionals, 1, 'ticket show <id>');
    result = resolveIssue(readIssues(filePath), positionals[0]);
  } else if (command === 'list' || command === 'ls') {
    result = commandList(readIssues(filePath), options);
  } else if (command === 'ready') {
    result = commandReady(readIssues(filePath));
  } else {
    throw new TicketError(`未知命令：${command}\n\n${usage()}`);
  }
  print(result, Boolean(options.json), options);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = error instanceof TicketError ? error.exitCode : 1;
  }
}
