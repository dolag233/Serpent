import { describe, expect, it } from 'vitest';

import {
  createScriptSandboxPreviewController,
  type ScriptSandboxPreviewWorker,
} from '../../src/renderer/script-sandbox-preview-controller';
import type {
  ScriptSandboxPreviewWorkerRequest,
  ScriptSandboxPreviewWorkerResponse,
} from '../../src/renderer/script-sandbox-preview-protocol';
import { isScriptSandboxPreviewWorkerResponse } from '../../src/renderer/script-sandbox-preview-protocol';

class FakePreviewWorker implements ScriptSandboxPreviewWorker {
  public onerror: ((event: { message: string }) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public readonly requests: ScriptSandboxPreviewWorkerRequest[] = [];
  public terminated = false;

  postMessage(message: ScriptSandboxPreviewWorkerRequest): void {
    this.requests.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(message: ScriptSandboxPreviewWorkerResponse): void {
    this.onmessage?.({ data: message });
  }
}

describe('ScriptSandboxPreviewController', () => {
  it('admits every fixed script command that the QuickJS host can emit', () => {
    for (const commandId of ['folder.list', 'asset.rename-files'] as const) {
      expect(isScriptSandboxPreviewWorkerResponse({
        type: 'automation-command',
        runId: 'run-1',
        requestId: 'command-1',
        commandId,
        input: {},
      })).toBe(true);
    }
  });

  it('starts a fresh Worker and reports its completed output', () => {
    const workers: FakePreviewWorker[] = [];
    const completed: ScriptSandboxPreviewWorkerResponse[] = [];
    const states: string[] = [];
    const controller = createScriptSandboxPreviewController({
      createWorker: () => {
        const worker = new FakePreviewWorker();
        workers.push(worker);
        return worker;
      },
      onCompleted: (message) => completed.push(message),
      onFailed: () => undefined,
      onStateChange: (state) => states.push(state),
      newRunId: () => 'run-1',
    });

    controller.run('return 6 * 7;');

    expect(workers).toHaveLength(1);
    expect(workers[0]?.requests).toEqual([
      { type: 'run', runId: 'run-1', source: 'return 6 * 7;' },
    ]);
    expect(states).toEqual(['running']);

    workers[0]?.respond({
      type: 'completed',
      runId: 'run-1',
      value: 42,
      output: ['"answer"'],
      transpiledJavaScript: 'return 6 * 7;\n',
    });

    expect(completed).toEqual([
      {
        type: 'completed',
        runId: 'run-1',
        value: 42,
        output: ['"answer"'],
        transpiledJavaScript: 'return 6 * 7;\n',
      },
    ]);
    expect(workers[0]?.terminated).toBe(true);
    expect(states).toEqual(['running', 'idle']);
  });

  it('terminates a running Worker on stop and ignores its late result', () => {
    const workers: FakePreviewWorker[] = [];
    const completed: ScriptSandboxPreviewWorkerResponse[] = [];
    const states: string[] = [];
    const controller = createScriptSandboxPreviewController({
      createWorker: () => {
        const worker = new FakePreviewWorker();
        workers.push(worker);
        return worker;
      },
      onCompleted: (message) => completed.push(message),
      onFailed: () => undefined,
      onStateChange: (state) => states.push(state),
      newRunId: () => 'run-1',
    });

    controller.run('while (true) {}');
    controller.stop();
    workers[0]?.respond({
      type: 'completed',
      runId: 'run-1',
      value: 'too late',
      output: [],
      transpiledJavaScript: '',
    });

    expect(workers[0]?.terminated).toBe(true);
    expect(completed).toEqual([]);
    expect(states).toEqual(['running', 'idle']);
  });

  it('forwards fixed automation commands without ending the active sandbox run', async () => {
    const workers: FakePreviewWorker[] = [];
    const controller = createScriptSandboxPreviewController({
      createWorker: () => {
        const worker = new FakePreviewWorker();
        workers.push(worker);
        return worker;
      },
      onCompleted: () => undefined,
      onFailed: () => undefined,
      onStateChange: () => undefined,
      newRunId: () => 'run-1',
      onAutomationCommand: async (message) => {
        expect(message).toMatchObject({ commandId: 'asset.search', input: { query: 'Ser' } });
        return { ok: true, result: [{ id: 'asset-1' }] };
      },
    });

    controller.run('return await serpent.assets.search({ query: "Ser" });');
    workers[0]?.respond({
      type: 'automation-command',
      runId: 'run-1',
      requestId: 'command-1',
      commandId: 'asset.search',
      input: { query: 'Ser' },
    });
    await Promise.resolve();

    expect(workers[0]?.terminated).toBe(false);
    expect(workers[0]?.requests.at(-1)).toEqual({
      type: 'automation-result',
      runId: 'run-1',
      requestId: 'command-1',
      result: { ok: true, result: [{ id: 'asset-1' }] },
    });
  });

  it('replaces the prior run, reports structured failures, and fails safely on Worker errors', () => {
    const workers: FakePreviewWorker[] = [];
    const failures: ScriptSandboxPreviewWorkerResponse[] = [];
    const states: string[] = [];
    let nextRun = 0;
    const controller = createScriptSandboxPreviewController({
      createWorker: () => {
        const worker = new FakePreviewWorker();
        workers.push(worker);
        return worker;
      },
      onCompleted: () => undefined,
      onFailed: (message) => failures.push(message),
      onStateChange: (state) => states.push(state),
      newRunId: () => `run-${++nextRun}`,
    });

    controller.run('return 1;');
    controller.run('return 2;');
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.requests[0]).toMatchObject({ runId: 'run-2' });

    workers[1]?.respond({
      type: 'failed',
      runId: 'run-2',
      code: 'CPU_TIMEOUT',
      message: 'The script exceeded its CPU time limit.',
    });
    expect(failures).toEqual([
      {
        type: 'failed',
        runId: 'run-2',
        code: 'CPU_TIMEOUT',
        message: 'The script exceeded its CPU time limit.',
      },
    ]);

    controller.run('return 3;');
    workers[2]?.onerror?.({ message: 'worker load failed' });
    expect(failures.at(-1)).toMatchObject({
      type: 'failed',
      code: 'RUNTIME_ERROR',
      message: 'The script preview worker stopped unexpectedly.',
    });
    expect(states.at(-1)).toBe('idle');
  });
});
