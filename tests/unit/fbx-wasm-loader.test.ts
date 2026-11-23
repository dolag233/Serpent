import { lstatSync, mkdtempSync, readdirSync, statfsSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseFbxBytes,
  resolveUfbxDir,
} from '../../src/worker/fbx/wasm-loader';
import {
  SerializedFbxParseQueue,
  SERPENT_UFBX_PARSE_PROTOCOL,
  type UfbxWorkerPort,
} from '../../src/worker/fbx/serialized-parse-queue';

const ownedRoots: string[] = [];
const fixturePrefix = 'serpent-fbx-wasm-loader-';
let previousUfbxDir: string | undefined;

function assertNoReparsePoints(root: string): void {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error('Owned FBX test fixture contains a reparse point.');
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const childPath = path.join(root, entry.name);
    const child = lstatSync(childPath);
    if (child.isSymbolicLink()) throw new Error('Owned FBX test fixture contains a reparse point.');
    if (child.isDirectory()) assertNoReparsePoints(childPath);
  }
}

function createOwnedRoot(): string {
  const parent = path.resolve(tmpdir());
  const available = statfsSync(parent);
  if (available.bavail * available.bsize < 8 * 1024 * 1024) {
    throw new Error('FBX unit fixture storage preflight failed.');
  }
  const root = mkdtempSync(path.join(parent, fixturePrefix));
  ownedRoots.push(root);
  return root;
}

function createFakeUfbxDirectory(root: string): {
  enteredMarker: string;
  queuedMarker: string;
} {
  const enteredMarker = path.join(root, 'active.marker');
  const queuedMarker = path.join(root, 'queued.marker');
  writeFileSync(path.join(root, 'ufbx.wasm'), Buffer.from([0]));
  const fakeGlue = `
'use strict';
const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const enteredMarker = ${JSON.stringify(enteredMarker)};
const queuedMarker = ${JSON.stringify(queuedMarker)};
module.exports = async (options) => {
  if (!fs.existsSync(options.locateFile('ufbx.wasm'))) throw new Error('fake wasm missing');
  const heap = new Uint8Array(1024 * 1024);
  let cursor = 64;
  let resultPointer = 0;
  let resultSize = 0;
  let errorPointer = 0;
  return {
    HEAPU8: heap,
    _malloc(size) { const pointer = cursor; cursor += size + 8; return pointer; },
    _free() {},
    _serpent_parse(inputPointer, inputSize) {
      const firstByte = heap[inputPointer];
      if (firstByte === 255) {
        fs.writeFileSync(enteredMarker, 'active');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
      if (firstByte === 2) fs.writeFileSync(queuedMarker, 'started');
      if (firstByte === 253) {
        throw Object.assign(new Error('native allocation failed'), { code: 'ENOMEM', errno: -12 });
      }
      if (firstByte === 254) {
        const errorBytes = Buffer.from(JSON.stringify({ code: 'oom', message: 'fixture bridge failure' }));
        errorPointer = 4096;
        heap.set(errorBytes, errorPointer);
        heap[errorPointer + errorBytes.length] = 0;
        return 1;
      }
      const output = Buffer.from([80, 65, 67, 75]);
      resultPointer = 8192;
      resultSize = output.length;
      heap.set(output, resultPointer);
      return 0;
    },
    _serpent_error() { return errorPointer; },
    _serpent_out_ptr() { return resultPointer; },
    _serpent_out_size() { return resultSize; },
    _serpent_free_out() {},
    UTF8ToString(pointer) {
      let end = pointer;
      while (heap[end] !== 0) end += 1;
      return Buffer.from(heap.subarray(pointer, end)).toString('utf8');
    },
  };
};
`;
  writeFileSync(path.join(root, 'ufbx.js'), fakeGlue);
  process.env['SERPENT_UFBX_DIR'] = root;
  return { enteredMarker, queuedMarker };
}

async function waitForOwnedFile(filePath: string): Promise<void> {
  await vi.waitFor(() => {
    expect(lstatSync(filePath, { throwIfNoEntry: false })).toBeDefined();
  }, { timeout: 5_000, interval: 10 });
}

class FakeWorker implements UfbxWorkerPort {
  readonly posted: Array<{ message: unknown; transferList: readonly ArrayBuffer[] }> = [];
  terminateCount = 0;
  exitCode: number | undefined;
  throwOnPost: Error | undefined;
  private readonly listeners = new Map<'message' | 'error' | 'exit', Set<(...args: never[]) => void>>();
  private resolveTermination: ((code: number) => void) | undefined;
  private termination: Promise<number> | undefined;

  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  on(event: 'message' | 'error' | 'exit', listener: (...args: never[]) => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(event: 'message', listener: (message: unknown) => void): this;
  removeListener(event: 'error', listener: (error: Error) => void): this;
  removeListener(event: 'exit', listener: (code: number) => void): this;
  removeListener(event: 'message' | 'error' | 'exit', listener: (...args: never[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  postMessage(message: unknown, transferList: readonly ArrayBuffer[] = []): void {
    if (this.throwOnPost) throw this.throwOnPost;
    this.posted.push({ message, transferList });
  }

  terminate(): Promise<number> {
    this.terminateCount += 1;
    if (this.exitCode !== undefined) return Promise.resolve(this.exitCode);
    this.termination ??= new Promise(resolve => { this.resolveTermination = resolve; });
    return this.termination;
  }

  emitMessage(message: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) listener(message as never);
  }

  emitError(error: Error): void {
    for (const listener of this.listeners.get('error') ?? []) listener(error as never);
  }

  emitExit(code: number): void {
    if (this.exitCode !== undefined) return;
    this.exitCode = code;
    for (const listener of this.listeners.get('exit') ?? []) listener(code as never);
    this.resolveTermination?.(code);
  }

  completeSuccess(bytes: readonly number[] = [7, 8, 9]): void {
    const first = this.posted[0]?.message as { id?: number } | undefined;
    this.emitMessage({
      protocol: SERPENT_UFBX_PARSE_PROTOCOL,
      id: first?.id,
      status: 'ok',
      buffer: Uint8Array.from(bytes).buffer,
    });
    this.emitExit(0);
  }
}

function fakeQueue(createWorker: () => FakeWorker): SerializedFbxParseQueue {
  return new SerializedFbxParseQueue('unit-worker-source', () => createWorker());
}

function queuedInput(bytes: Buffer, filename = 'fixture.fbx') {
  return { fbxBytes: bytes, filename, maxTriangles: 0, ufbxDir: 'owned-fixture-root' };
}

beforeEach(() => {
  previousUfbxDir = process.env['SERPENT_UFBX_DIR'];
});

afterEach(async () => {
  if (previousUfbxDir === undefined) delete process.env['SERPENT_UFBX_DIR'];
  else process.env['SERPENT_UFBX_DIR'] = previousUfbxDir;
  previousUfbxDir = undefined;
  for (const root of ownedRoots.splice(0)) {
    const parent = path.resolve(tmpdir());
    if (path.dirname(root) !== parent || !path.basename(root).startsWith(fixturePrefix)) {
      throw new Error('FBX unit fixture cleanup ownership check failed.');
    }
    assertNoReparsePoints(root);
    await rm(root, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
  }
});

describe('serialized FBX parser worker lifecycle', () => {
  it('keeps a queued abort from spawning and waits for an active worker exit before advancing', async () => {
    const workers: FakeWorker[] = [];
    const queue = fakeQueue(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const callerBuffer = Buffer.from([1, 2, 3]);
    const first = queue.parse(queuedInput(callerBuffer));
    const cancelled = new AbortController();
    const cancelReason = new Error('queued parse cancelled');
    const second = queue.parse(queuedInput(Buffer.from([4]), 'queued.fbx'), cancelled.signal);

    cancelled.abort(cancelReason);
    await expect(second).rejects.toBe(cancelReason);
    expect(workers).toHaveLength(1);
    expect(callerBuffer).toEqual(Buffer.from([1, 2, 3]));
    expect(workers[0]?.posted[0]?.transferList).toHaveLength(1);
    expect(workers[0]?.posted[0]?.transferList[0]).not.toBe(callerBuffer.buffer);

    workers[0]?.completeSuccess([1, 1]);
    await expect(first).resolves.toEqual(Buffer.from([1, 1]));
    expect(workers).toHaveLength(1);
  });

  it('terminates an active parse, waits for exit, then starts the next queued parse', async () => {
    const workers: FakeWorker[] = [];
    const queue = fakeQueue(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const active = new AbortController();
    const reason = new Error('active parse cancelled');
    const first = queue.parse(queuedInput(Buffer.from([1])), active.signal);
    const second = queue.parse(queuedInput(Buffer.from([2]), 'next.fbx'));
    let firstSettled = false;
    void first.catch(() => { firstSettled = true; });

    active.abort(reason);
    expect(workers[0]?.terminateCount).toBe(1);
    await Promise.resolve();
    expect(firstSettled).toBe(false);
    expect(workers).toHaveLength(1);

    workers[0]?.emitExit(1);
    await expect(first).rejects.toBe(reason);
    expect(workers).toHaveLength(2);
    workers[1]?.completeSuccess([3, 4]);
    await expect(second).resolves.toEqual(Buffer.from([3, 4]));
  });

  it('waits for thread exit after postMessage failure and propagates error-before-result', async () => {
    const workers: FakeWorker[] = [];
    const queue = fakeQueue(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      if (workers.length === 1) worker.throwOnPost = new Error('post failed');
      return worker;
    });
    const first = queue.parse(queuedInput(Buffer.from([1])));
    const second = queue.parse(queuedInput(Buffer.from([2])));
    let firstSettled = false;
    void first.catch(() => { firstSettled = true; });

    await vi.waitFor(() => expect(workers[0]?.terminateCount).toBe(1), { timeout: 1_000 });
    expect(firstSettled).toBe(false);
    expect(workers).toHaveLength(1);
    workers[0]?.emitExit(1);
    await expect(first).rejects.toThrow('post failed');
    expect(workers).toHaveLength(2);

    const workerFailure = new Error('worker failed before result');
    workers[1]?.emitError(workerFailure);
    workers[1]?.emitExit(1);
    await expect(second).rejects.toBe(workerFailure);
  });

  it('fails a malformed response only after exit and continues with the next request', async () => {
    const workers: FakeWorker[] = [];
    const queue = fakeQueue(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const invalid = queue.parse(queuedInput(Buffer.from([1])));
    const next = queue.parse(queuedInput(Buffer.from([2])));
    let invalidSettled = false;
    void invalid.catch(() => { invalidSettled = true; });
    const request = workers[0]?.posted[0]?.message as { id: number };
    workers[0]?.emitMessage({
      protocol: SERPENT_UFBX_PARSE_PROTOCOL,
      id: request.id + 1,
      status: 'ok',
      buffer: new ArrayBuffer(0),
    });
    expect(workers[0]?.terminateCount).toBe(1);
    await Promise.resolve();
    expect(invalidSettled).toBe(false);
    expect(workers).toHaveLength(1);
    workers[0]?.emitExit(1);
    await expect(invalid).rejects.toThrow(/response/i);
    expect(workers).toHaveLength(2);
    workers[1]?.completeSuccess([5]);
    await expect(next).resolves.toEqual(Buffer.from([5]));
  });

  it('rejects an exit without a response and recovers from worker construction failure', async () => {
    const workers: FakeWorker[] = [];
    let creationCount = 0;
    const queue = new SerializedFbxParseQueue('unit-worker-source', () => {
      creationCount += 1;
      if (creationCount === 1) throw new Error('worker construction failed');
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const constructionFailure = queue.parse(queuedInput(Buffer.from([1])));
    const exitedEarly = queue.parse(queuedInput(Buffer.from([2])));
    await expect(constructionFailure).rejects.toThrow('worker construction failed');
    expect(workers).toHaveLength(1);

    workers[0]?.emitExit(0);
    await expect(exitedEarly).rejects.toThrow(/before returning a result/i);
  });

  it('rejects malformed optional native error metadata', async () => {
    const workers: FakeWorker[] = [];
    const queue = fakeQueue(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const invalid = queue.parse(queuedInput(Buffer.from([1])));
    const request = workers[0]?.posted[0]?.message as { id: number };
    workers[0]?.emitMessage({
      protocol: SERPENT_UFBX_PARSE_PROTOCOL,
      id: request.id,
      status: 'error',
      message: 'invalid metadata',
      code: { value: 'ENOMEM' },
      errno: -12,
    });
    expect(workers[0]?.terminateCount).toBe(1);
    workers[0]?.emitExit(1);
    await expect(invalid).rejects.toThrow(/invalid error response/i);
  });

  it('uses the real CJS bootstrap, preserves caller bytes, and releases a blocked worker on abort', async () => {
    const root = createOwnedRoot();
    const markers = createFakeUfbxDirectory(root);
    expect(resolveUfbxDir()).toBe(root);

    const originalBytes = Buffer.from([255, 2, 3]);
    const controller = new AbortController();
    const aborted = parseFbxBytes(originalBytes, {
      filename: 'blocked.fbx',
      signal: controller.signal,
    });
    let next: Promise<Buffer> | undefined;
    try {
      await waitForOwnedFile(markers.enteredMarker);
      const nextBytes = Buffer.from([2, 4]);
      next = parseFbxBytes(nextBytes, { filename: 'next.fbx' });
      await Promise.resolve();
      expect(lstatSync(markers.queuedMarker, { throwIfNoEntry: false })).toBeUndefined();
      expect(originalBytes).toEqual(Buffer.from([255, 2, 3]));
      expect(nextBytes).toEqual(Buffer.from([2, 4]));

      const abortReason = new Error('stop active wasm parse');
      controller.abort(abortReason);
      await expect(aborted).rejects.toBe(abortReason);
      await expect(next).resolves.toEqual(Buffer.from([80, 65, 67, 75]));
      await waitForOwnedFile(markers.queuedMarker);
    } finally {
      if (!controller.signal.aborted) controller.abort(new Error('test cleanup abort'));
      await aborted.catch(() => undefined);
      await next?.catch(() => undefined);
    }

    await expect(parseFbxBytes(Buffer.from([254]), { filename: 'bridge-error.fbx' }))
      .rejects.toThrow(JSON.stringify({ code: 'oom', message: 'fixture bridge failure' }));
    await expect(parseFbxBytes(Buffer.from([253]), { filename: 'native-error.fbx' }))
      .rejects.toMatchObject({ message: 'native allocation failed', code: 'ENOMEM', errno: -12 });
  });
});
