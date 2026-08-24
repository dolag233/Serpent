import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { issuesPath, readIssues, TicketError, writeIssues } from '../../scripts/ticket.mjs';

const scriptPath = path.resolve(process.cwd(), 'scripts/ticket.mjs');
const temporaryRoots: string[] = [];

function createRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'serpent-tickets-'));
  temporaryRoots.push(root);
  return root;
}

function run(root: string, ...arguments_: string[]) {
  const result = spawnSync(
    process.execPath,
    [scriptPath, ...arguments_, '--root', root],
    { encoding: 'utf8' },
  );
  return {
    status: result.status,
    stdout: result.stdout as string,
    stderr: result.stderr as string,
  };
}

function add(root: string, title: string, ...arguments_: string[]) {
  const result = run(root, 'add', title, ...arguments_, '--json');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as { id: string };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('text ticket CLI', () => {
  it('creates, displays, edits, and changes the status of a JSONL ticket', () => {
    const root = createRoot();
    const created = add(root, '记录导入性能', '--body', '先测量再优化', '-p', '1', '-l', 'eagle,perf');

    const shown = run(root, 'show', created.id, '--json');
    expect(shown.status).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      id: created.id,
      title: '记录导入性能',
      description: '先测量再优化',
      priority: 1,
      labels: ['eagle', 'perf'],
      status: 'open',
    });

    expect(run(root, 'desc', created.id, '--body', '插桩转换和缩略图阶段').status).toBe(0);
    expect(run(root, 'status', created.id, 'closed', '--reason', '已完成插桩').status).toBe(0);
    const issuePath = path.join(root, '.beads', 'issues.jsonl');
    const legacyIssue = JSON.parse(fs.readFileSync(issuePath, 'utf8').trim());
    delete legacyIssue.comments;
    fs.writeFileSync(issuePath, `${JSON.stringify(legacyIssue)}\n`);
    expect(run(root, 'comment', created.id, '--text', '用户验收通过；附截图').status).toBe(0);

    const closed = JSON.parse(run(root, 'show', created.id, '--json').stdout);
    expect(closed).toMatchObject({
      description: '插桩转换和缩略图阶段',
      status: 'closed',
      close_reason: '已完成插桩',
    });
    expect(closed.comments).toEqual([
      expect.objectContaining({ issue_id: created.id, text: '用户验收通过；附截图' }),
    ]);
    const issueLines = fs
      .readFileSync(path.join(root, '.beads', 'issues.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(issueLines).toHaveLength(1);
    expect(JSON.parse(issueLines[0] ?? '')).toMatchObject({ id: created.id });
  });

  it('lists ready work based on closed blockers', () => {
    const root = createRoot();
    const blocked = add(root, '实现优化');
    const blocker = add(root, '先做 profiling', '-p', '1');

    expect(run(root, 'dep', 'add', blocked.id, blocker.id).status).toBe(0);
    const beforeClose = JSON.parse(run(root, 'ready', '--json').stdout) as Array<{ id: string }>;
    expect(beforeClose.map((ticket) => ticket.id)).toEqual([blocker.id]);

    expect(run(root, 'status', blocker.id, 'closed').status).toBe(0);
    const afterClose = JSON.parse(run(root, 'ready', '--json').stdout) as Array<{ id: string }>;
    expect(afterClose.map((ticket) => ticket.id)).toContain(blocked.id);
  });

  it('prevents stealing a claimed ticket and protects dependencies on delete', () => {
    const root = createRoot();
    const owner = add(root, '正在处理', '--assignee', 'another-agent');
    expect(run(root, 'claim', owner.id, '--assignee', 'dolag').status).not.toBe(0);

    const dependent = add(root, '依赖处理结果');
    expect(run(root, 'dep', 'add', dependent.id, owner.id).status).toBe(0);
    expect(run(root, 'delete', owner.id).status).not.toBe(0);
    expect(run(root, 'delete', owner.id, '--force').status).toBe(0);

    const remaining = JSON.parse(run(root, 'show', dependent.id, '--json').stdout);
    expect(remaining.dependencies).toEqual([]);
  });

  it('requires a reason when reopening a closed ticket and records it as a comment', () => {
    const root = createRoot();
    const ticket = add(root, '需要重新验证');

    expect(run(root, 'status', ticket.id, 'closed').status).toBe(0);
    expect(run(root, 'status', ticket.id, 'open').status).not.toBe(0);
    expect(run(root, 'status', ticket.id, 'in_progress', '--reason', '用户报告回归').status).toBe(0);

    const reopened = JSON.parse(run(root, 'show', ticket.id, '--json').stdout);
    expect(reopened).toMatchObject({
      status: 'in_progress',
      comments: [
        expect.objectContaining({
          issue_id: ticket.id,
          text: '重新打开：用户报告回归',
        }),
      ],
    });
  });

  it('supports compact list output and accepts the bd-compatible all flag', () => {
    const root = createRoot();
    const first = add(root, '第一条');
    const second = add(root, '第二条', '-p', '1');

    const idsOnly = JSON.parse(run(root, 'list', '--all', '--ids-only', '--json').stdout);
    expect(idsOnly).toEqual([second.id, first.id]);

    const fields = JSON.parse(
      run(root, 'list', '--fields', 'id,title,status,priority', '--json').stdout,
    );
    expect(fields).toEqual([
      { id: second.id, title: '第二条', status: 'open', priority: 1 },
      { id: first.id, title: '第一条', status: 'open', priority: 2 },
    ]);

    const full = JSON.parse(run(root, 'list', '--all', '--json').stdout);
    expect(full[0]).toHaveProperty('comments');
    expect(full[0]).toHaveProperty('dependencies');
  });

  it('updates a ticket priority through the text CLI', () => {
    const root = createRoot();
    const ticket = add(root, '需要降级处理', '-p', '1', '-l', 'p1,rename');

    const updated = run(root, 'priority', ticket.id, '2', '--json');
    expect(updated.status).toBe(0);
    expect(JSON.parse(updated.stdout)).toMatchObject({
      id: ticket.id,
      priority: 2,
      labels: ['p2', 'rename'],
    });
  });

  it('refuses to overwrite a non-empty JSONL with an empty issue list', () => {
    const root = createRoot();
    add(root, '不得被空写覆盖');
    const filePath = issuesPath(root);
    expect(() => writeIssues(filePath, [])).toThrow(TicketError);
    expect(readIssues(filePath)).toHaveLength(1);
  });

});
