import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import type { AppLogger } from '../../src/main/app-logger';
import { createPublicError } from '../../src/shared/protocol/errors';

class FakeUtilityProcess extends EventEmitter {
  readonly pid = 1234;
  readonly postMessage = vi.fn();
  readonly kill = vi.fn();
}

const utilityProcessFork = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({
  utilityProcess: { fork: utilityProcessFork },
}));

import {
  LibraryWorkerClient,
  WorkerUnavailableError,
  WorkerRequestTimeoutError,
  requestTimeoutForCommand,
} from '../../src/main/worker-client';

it('restores the known library before admitting requests after a Worker exit', async () => {
  const previousFfmpegPath = process.env.SERPENT_FFMPEG_PATH;
  const previousOiioPath = process.env.SERPENT_OIIO_PATH;
  process.env.SERPENT_FFMPEG_PATH = process.execPath;
  process.env.SERPENT_OIIO_PATH = process.execPath;
  utilityProcessFork.mockReset();
  const first = new FakeUtilityProcess();
  const second = new FakeUtilityProcess();
  utilityProcessFork.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const logger = { worker: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as AppLogger;
  const client = new LibraryWorkerClient('fixture-worker.js', logger);
  try {
    const starting = client.start();
    first.emit('message', { type: 'worker.ready' });
    await starting;
    const listed = client.request({ type: 'library.list' });
    const listRequest = first.postMessage.mock.calls.at(-1)?.[0] as { requestId: string };
    first.emit('message', {
      requestId: listRequest.requestId,
      result: {
        ok: true,
        type: 'library.list',
        libraries: [{ libraryId: 'fixture-library', libraryPath: 'fixture-library', displayName: 'Fixture' }],
      },
    });
    await listed;

    const states: string[] = [];
    client.onRecovery((event) => states.push(event.state));
    first.emit('exit', 1);
    expect(client.available).toBe(false);
    const waiting = client.request({ type: 'library.list' });
    const waitingResult = expect(waiting).resolves.toMatchObject({ ok: true, type: 'library.list' });
    expect(second.postMessage).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(utilityProcessFork).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    second.emit('message', { type: 'worker.ready' });
    await vi.waitFor(() => expect(second.postMessage).toHaveBeenCalled(), { timeout: 1_000 });
    const reopen = second.postMessage.mock.calls.at(-1)?.[0] as {
      requestId: string;
      command: { type: string; selectedLibraryPath?: string };
    };
    expect(reopen.command).toEqual({ type: 'library.open', selectedLibraryPath: 'fixture-library' });
    second.emit('message', {
      requestId: reopen.requestId,
      result: {
        ok: true,
        type: 'library.opened',
        library: { libraryId: 'fixture-library', libraryPath: 'fixture-library', displayName: 'Fixture' },
      },
    });
    await vi.waitFor(() => expect(states).toEqual(['recovering', 'recovered']), { timeout: 1_000 });
    expect(states).toEqual(['recovering', 'recovered']);
    await vi.waitFor(() => expect(second.postMessage).toHaveBeenCalledTimes(2), { timeout: 1_000 });
    const postRecovery = second.postMessage.mock.calls.at(-1)?.[0] as { requestId: string; command: { type: string } };
    expect(postRecovery.command.type).toBe('library.list');
    second.emit('message', {
      requestId: postRecovery.requestId,
      result: { ok: true, type: 'library.list', libraries: [] },
    });
    await waitingResult;
    expect(client.available).toBe(true);
    first.emit('exit', 2);
    expect(client.available).toBe(true);
    expect(utilityProcessFork).toHaveBeenCalledTimes(2);
  } finally {
    const stop = client.shutdown();
    first.emit('message', { type: 'worker.shutdown.ack' });
    second.emit('message', { type: 'worker.shutdown.ack' });
    await stop;
    if (previousFfmpegPath === undefined) delete process.env.SERPENT_FFMPEG_PATH;
    else process.env.SERPENT_FFMPEG_PATH = previousFfmpegPath;
    if (previousOiioPath === undefined) delete process.env.SERPENT_OIIO_PATH;
    else process.env.SERPENT_OIIO_PATH = previousOiioPath;
  }
});

it('stops restarting after repeated unexpected Worker exits', async () => {
  utilityProcessFork.mockReset();
  const previousFfmpegPath = process.env.SERPENT_FFMPEG_PATH;
  const previousOiioPath = process.env.SERPENT_OIIO_PATH;
  process.env.SERPENT_FFMPEG_PATH = process.execPath;
  process.env.SERPENT_OIIO_PATH = process.execPath;
  const children = [new FakeUtilityProcess(), new FakeUtilityProcess(), new FakeUtilityProcess()];
  for (const child of children) utilityProcessFork.mockReturnValueOnce(child);
  const logger = { worker: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as AppLogger;
  const client = new LibraryWorkerClient('fixture-worker.js', logger);
  try {
    const starting = client.start();
    children[0]!.emit('message', { type: 'worker.ready' });
    await starting;
    const states: string[] = [];
    client.onRecovery((event) => states.push(event.state));
    for (let index = 0; index < 2; index += 1) {
      children[index]!.emit('exit', 1);
      await vi.waitFor(() => expect(utilityProcessFork).toHaveBeenCalledTimes(index + 2), { timeout: 2_000 });
      children[index + 1]!.emit('message', { type: 'worker.ready' });
      await vi.waitFor(() => expect(client.available).toBe(true), { timeout: 1_000 });
    }
    children[2]!.emit('exit', 1);
    expect(client.available).toBe(false);
    expect(states).toEqual(['recovering', 'recovered', 'recovering', 'recovered', 'failed']);
    expect(utilityProcessFork).toHaveBeenCalledTimes(3);
    await expect(client.request({ type: 'library.list' })).rejects.toMatchObject({
      code: 'WORKER_UNAVAILABLE',
    });
  } finally {
    await client.shutdown();
    if (previousFfmpegPath === undefined) delete process.env.SERPENT_FFMPEG_PATH;
    else process.env.SERPENT_FFMPEG_PATH = previousFfmpegPath;
    if (previousOiioPath === undefined) delete process.env.SERPENT_OIIO_PATH;
    else process.env.SERPENT_OIIO_PATH = previousOiioPath;
  }
});

it('reports a library that cannot be reopened without discarding a healthy Worker', async () => {
  utilityProcessFork.mockReset();
  const previousFfmpegPath = process.env.SERPENT_FFMPEG_PATH;
  const previousOiioPath = process.env.SERPENT_OIIO_PATH;
  process.env.SERPENT_FFMPEG_PATH = process.execPath;
  process.env.SERPENT_OIIO_PATH = process.execPath;
  const first = new FakeUtilityProcess();
  const second = new FakeUtilityProcess();
  utilityProcessFork.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const logger = { worker: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as AppLogger;
  const client = new LibraryWorkerClient('fixture-worker.js', logger);
  try {
    const starting = client.start();
    first.emit('message', { type: 'worker.ready' });
    await starting;
    const listed = client.request({ type: 'library.list' });
    const listing = first.postMessage.mock.calls.at(-1)?.[0] as { requestId: string };
    first.emit('message', {
      requestId: listing.requestId,
      result: { ok: true, type: 'library.list', libraries: [
        { libraryId: 'missing-library', libraryPath: 'fixture-missing', displayName: 'Missing fixture' },
      ] },
    });
    await listed;
    const recovered: Array<{ failedLibraryIds: string[] }> = [];
    client.onRecovery((event) => {
      if (event.state === 'recovered') recovered.push(event);
    });
    first.emit('exit', 1);
    await vi.waitFor(() => expect(utilityProcessFork).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    second.emit('message', { type: 'worker.ready' });
    await vi.waitFor(() => expect(second.postMessage).toHaveBeenCalled(), { timeout: 1_000 });
    const reopen = second.postMessage.mock.calls.at(-1)?.[0] as { requestId: string };
    second.emit('message', {
      requestId: reopen.requestId,
      result: { ok: false, error: createPublicError('LIBRARY_NOT_FOUND') },
    });
    await vi.waitFor(() => expect(recovered).toHaveLength(1), { timeout: 1_000 });
    expect(recovered[0]?.failedLibraryIds).toEqual(['missing-library']);
    expect(client.available).toBe(true);
  } finally {
    await client.shutdown();
    if (previousFfmpegPath === undefined) delete process.env.SERPENT_FFMPEG_PATH;
    else process.env.SERPENT_FFMPEG_PATH = previousFfmpegPath;
    if (previousOiioPath === undefined) delete process.env.SERPENT_OIIO_PATH;
    else process.env.SERPENT_OIIO_PATH = previousOiioPath;
  }
});

it('names unavailable Worker failures for public error classification', () => {
  expect(new WorkerUnavailableError().code).toBe('WORKER_UNAVAILABLE');
});

describe('requestTimeoutForCommand', () => {
  it('allows browser capture to finish its bounded download before Main times out', () => {
    expect(requestTimeoutForCommand('extension.save-from-url')).toBe(5 * 60_000);
  });

  it('does not impose a wall-clock timeout on local library commands', () => {
    expect(requestTimeoutForCommand('asset.list')).toBeNull();
    expect(requestTimeoutForCommand('folder.browse-entries')).toBeNull();
    expect(requestTimeoutForCommand('linked-folder.relink')).toBeNull();
    expect(requestTimeoutForCommand('media.get-preview-artifact')).toBeNull();
    expect(requestTimeoutForCommand('model.convert-fbx')).toBeNull();
  });

  it('does not impose a wall-clock timeout on local reads', () => {
    expect(requestTimeoutForCommand('asset.search')).toBeNull();
    expect(requestTimeoutForCommand('media.get-asset-drag-infos')).toBeNull();
    expect(requestTimeoutForCommand('smart-collection.execute')).toBeNull();
  });

  it('does not impose a wall-clock timeout on disk-bound library transfers (Serpent-4s8b)', () => {
    expect(requestTimeoutForCommand('library.create')).toBeNull();
    expect(requestTimeoutForCommand('library.open')).toBeNull();
    expect(requestTimeoutForCommand('library.open-eagle')).toBeNull();
    expect(requestTimeoutForCommand('library.open-billfish')).toBeNull();
    expect(requestTimeoutForCommand('library.inspect-eagle')).toBeNull();
    expect(requestTimeoutForCommand('asset.import-eagle')).toBeNull();
    expect(requestTimeoutForCommand('asset.import-billfish')).toBeNull();
    expect(requestTimeoutForCommand('library.export')).toBeNull();
    expect(requestTimeoutForCommand('library.import-folder')).toBeNull();
    expect(requestTimeoutForCommand('library.import-zip')).toBeNull();
    expect(requestTimeoutForCommand('asset.refresh')).toBeNull();
    expect(requestTimeoutForCommand('asset.delete-linked')).toBeNull();
    expect(requestTimeoutForCommand('sync.preview')).toBeNull();
    expect(requestTimeoutForCommand('sync.run')).toBeNull();
    expect(requestTimeoutForCommand('sync.list-remote-libraries')).toBeNull();
    expect(requestTimeoutForCommand('sync.open-remote-library')).toBeNull();
    expect(requestTimeoutForCommand({
      type: 'asset.import.prepare',
      libraryId: 'library-1',
      sourceKind: 'files',
      sourcePaths: ['/tmp/a.png'],
    })).toBeNull();
    expect(requestTimeoutForCommand({
      type: 'asset.import-linked',
      libraryId: 'library-1',
      sourceRootPath: '/tmp/linked-assets',
    })).toBeNull();
    expect(requestTimeoutForCommand({
      type: 'automation.file-import-plan',
      libraryId: 'library-1',
      sourceKind: 'files',
      sourcePaths: ['/tmp/a.png'],
    })).toBeNull();
    expect(requestTimeoutForCommand({
      type: 'automation.file-operation-plan',
      libraryId: 'library-1',
      operation: 'trash',
      assetIds: ['asset-1'],
    })).toBeNull();
  });

  it('names worker timeouts so Main can map them to a public reason (Serpent-sq4i)', () => {
    const error = new WorkerRequestTimeoutError('req-1', 'library.open-eagle');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('WORKER_REQUEST_TIMEOUT');
    expect(error.commandType).toBe('library.open-eagle');
  });

  it('lets an unbounded Eagle conversion finish after the old 30-minute deadline (Serpent-4s8b)', async () => {
    vi.useFakeTimers();
    const previousFfmpegPath = process.env.SERPENT_FFMPEG_PATH;
    const previousOiioPath = process.env.SERPENT_OIIO_PATH;
    process.env.SERPENT_FFMPEG_PATH = '/usr/bin/true';
    process.env.SERPENT_OIIO_PATH = '/usr/bin/true';
    try {
      const child = new FakeUtilityProcess();
      utilityProcessFork.mockReturnValueOnce(child);
      const logger = {
        worker: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
      } as unknown as AppLogger;
      const client = new LibraryWorkerClient('/tmp/library-worker.js', logger);
      const start = client.start();
      child.emit('message', { type: 'worker.ready' });
      await start;

      let settled = false;
      const pending = client.request({
        type: 'library.open-eagle',
        sourceRootPath: 'C:\\eagle',
        selectedParentPath: 'C:\\out',
        displayName: 'Eagle',
      }).finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(31 * 60_000);
      expect(settled).toBe(false);

      const posted = child.postMessage.mock.calls.at(-1)?.[0] as { requestId: string };
      child.emit('message', {
        requestId: posted.requestId,
        result: { ok: true, type: 'library.closed', libraryId: 'library-1' },
      });
      await expect(pending).resolves.toMatchObject({ ok: true, type: 'library.closed' });
    } finally {
      vi.useRealTimers();
      if (previousFfmpegPath === undefined) delete process.env.SERPENT_FFMPEG_PATH;
      else process.env.SERPENT_FFMPEG_PATH = previousFfmpegPath;
      if (previousOiioPath === undefined) delete process.env.SERPENT_OIIO_PATH;
      else process.env.SERPENT_OIIO_PATH = previousOiioPath;
    }
  });

  it('rejects a timed-out request with a typed timeout error carrying the command', async () => {
    vi.useFakeTimers();
    utilityProcessFork.mockClear();
    const previousFfmpegPath = process.env.SERPENT_FFMPEG_PATH;
    const previousOiioPath = process.env.SERPENT_OIIO_PATH;
    process.env.SERPENT_FFMPEG_PATH = '/usr/bin/true';
    process.env.SERPENT_OIIO_PATH = '/usr/bin/true';
    try {
      const child = new FakeUtilityProcess();
      utilityProcessFork.mockReturnValueOnce(child);
      const logger = {
        worker: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
      } as unknown as AppLogger;
      const client = new LibraryWorkerClient('/tmp/library-worker.js', logger);

      const start = client.start();
      child.emit('message', { type: 'worker.ready' });
      await start;

      const pending = client.request({
        type: 'ai.test-connection',
        apiFormat: 'openai_chat',
        apiKey: 'ephemeral-key',
        model: 'model',
      });
      // 先 attach rejection 处理器再推进时间，避免 timer 触发时 unhandled。
      const pendingRejection = expect(pending).rejects.toMatchObject({
        name: 'WorkerRequestTimeoutError',
        code: 'WORKER_REQUEST_TIMEOUT',
        commandType: 'ai.test-connection',
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await pendingRejection;

      const shutdown = client.shutdown();
      child.emit('message', { type: 'worker.shutdown.ack' });
      await shutdown;
    } finally {
      vi.useRealTimers();
      if (previousFfmpegPath === undefined) delete process.env.SERPENT_FFMPEG_PATH;
      else process.env.SERPENT_FFMPEG_PATH = previousFfmpegPath;
      if (previousOiioPath === undefined) delete process.env.SERPENT_OIIO_PATH;
      else process.env.SERPENT_OIIO_PATH = previousOiioPath;
    }
  });

  it('gives AI queue processing a long timeout (Serpent-iokf)', () => {
    expect(requestTimeoutForCommand('ai.process-queue')).toBe(10 * 60_000);
    expect(requestTimeoutForCommand('asset.analyze')).toBe(10 * 60_000);
  });

  it('waits for all bounded request waves when a user lowers AI concurrency', () => {
    expect(requestTimeoutForCommand({
      type: 'ai.process-queue',
      libraryId: 'library-1',
      apiFormat: 'dashscope_native',
      model: 'qwen3-vl-plus',
      apiKey: 'ephemeral-key',
      enabledFields: { description: true, tags: true, rating: false },
      analysisSettings: {
        forceExistingTags: false,
        maxTags: 8,
        maxDescriptionCharsZh: 100,
        maxDescriptionWordsEn: 60,
        outputStyle: 'normal',
        ratingRubric: 'score 1-5',
        customDescriptionPrompt: '',
        customTagPrompt: '',
      },
      languages: ['zh-CN'],
      concurrencyLimit: 1,
      requestTimeoutMs: 120_000,
      maxAttempts: 3,
      maxJobs: 20,
    })).toBe(2_460_000);
  });

  it('does not kill the Worker when a malformed model render event arrives', async () => {
    const child = new FakeUtilityProcess();
    utilityProcessFork.mockReturnValueOnce(child);
    const logger = {
      worker: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    } as unknown as AppLogger;
    const client = new LibraryWorkerClient('/tmp/library-worker.js', logger);

    const previousFfmpegPath = process.env.SERPENT_FFMPEG_PATH;
    const previousOiioPath = process.env.SERPENT_OIIO_PATH;
    process.env.SERPENT_FFMPEG_PATH = '/usr/bin/true';
    process.env.SERPENT_OIIO_PATH = '/usr/bin/true';
    const start = client.start();
    child.emit('message', { type: 'worker.ready' });
    await start;

    child.emit('message', {
      type: 'model-thumbnail.render-request',
      requestId: 'model-request-1',
      libraryId: 'library-1',
      assetId: 'asset-1',
      revisionId: 'revision-1',
      format: 'glb',
      renderUrl: 'serpent://source/library-1/asset-1',
      companionMap: [],
      sourceAuthorizations: [],
      hdriPresetId: 'studio-small-09',
      width: 8,
      height: 512,
      timeoutMs: 30_000,
    });

    expect(child.kill).not.toHaveBeenCalled();
    expect(child.postMessage).toHaveBeenCalledWith({
      type: 'model-thumbnail.render-response',
      requestId: 'model-request-1',
      result: {
        status: 'failed',
        errorCode: 'MODEL_LOAD_FAILED',
        reason: 'The model thumbnail request was invalid.',
      },
    });
    expect(logger.error).toHaveBeenCalledWith(
      'worker.model-thumbnail.invalid-request',
      expect.anything(),
      expect.objectContaining({ hasRequestId: true }),
    );

    const shutdown = client.shutdown();
    child.emit('message', { type: 'worker.shutdown.ack' });
    await shutdown;
    if (previousFfmpegPath === undefined) delete process.env.SERPENT_FFMPEG_PATH;
    else process.env.SERPENT_FFMPEG_PATH = previousFfmpegPath;
    if (previousOiioPath === undefined) delete process.env.SERPENT_OIIO_PATH;
    else process.env.SERPENT_OIIO_PATH = previousOiioPath;
  });

  it('forwards model render cancellation to Main without treating it as a Worker response', async () => {
    const child = new FakeUtilityProcess();
    utilityProcessFork.mockReturnValueOnce(child);
    const logger = {
      worker: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    } as unknown as AppLogger;
    const client = new LibraryWorkerClient('/tmp/library-worker.js', logger);
    const previousFfmpegPath = process.env.SERPENT_FFMPEG_PATH;
    const previousOiioPath = process.env.SERPENT_OIIO_PATH;
    process.env.SERPENT_FFMPEG_PATH = '/usr/bin/true';
    process.env.SERPENT_OIIO_PATH = '/usr/bin/true';
    try {
      const start = client.start();
      child.emit('message', { type: 'worker.ready' });
      await start;

      const cancelled: string[] = [];
      client.onModelThumbnailRenderCancel((requestId) => cancelled.push(requestId));
      child.emit('message', {
        type: 'model-thumbnail.render-cancel',
        requestId: 'model-request-1',
      });

      expect(cancelled).toEqual(['model-request-1']);
      expect(child.kill).not.toHaveBeenCalled();

      child.emit('message', {
        type: 'model-thumbnail.render-cancel',
        requestId: ' ',
      });
      expect(logger.error).toHaveBeenCalledWith(
        'worker.model-thumbnail.invalid-cancel',
        expect.anything(),
      );

      const shutdown = client.shutdown();
      child.emit('message', { type: 'worker.shutdown.ack' });
      await shutdown;
    } finally {
      if (previousFfmpegPath === undefined) delete process.env.SERPENT_FFMPEG_PATH;
      else process.env.SERPENT_FFMPEG_PATH = previousFfmpegPath;
      if (previousOiioPath === undefined) delete process.env.SERPENT_OIIO_PATH;
      else process.env.SERPENT_OIIO_PATH = previousOiioPath;
    }
  });

  it('passes an explicit missing FFmpeg path to the Worker unchanged', async () => {
    const child = new FakeUtilityProcess();
    utilityProcessFork.mockReturnValueOnce(child);
    const logger = {
      worker: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    } as unknown as AppLogger;
    const client = new LibraryWorkerClient('/tmp/library-worker.js', logger);
    const previousFfmpegPath = process.env.SERPENT_FFMPEG_PATH;
    const previousOiioPath = process.env.SERPENT_OIIO_PATH;
    const missingFfmpegPath = '/tmp/serpent-missing-ffmpeg';
    process.env.SERPENT_FFMPEG_PATH = missingFfmpegPath;
    process.env.SERPENT_OIIO_PATH = '/tmp/serpent-oiiotool';

    try {
      const start = client.start();
      child.emit('message', { type: 'worker.ready' });
      await start;

      expect(utilityProcessFork).toHaveBeenCalledWith(
        '/tmp/library-worker.js',
        [],
        expect.objectContaining({
          env: expect.objectContaining({ SERPENT_FFMPEG_PATH: missingFfmpegPath }),
        }),
      );

      const forkOptions = utilityProcessFork.mock.calls.at(-1)?.[2] as {
        env?: NodeJS.ProcessEnv;
      } | undefined;
      expect(forkOptions?.env?.SERPENT_FFMPEG_PATH).toBe(missingFfmpegPath);

      const shutdown = client.shutdown();
      child.emit('message', { type: 'worker.shutdown.ack' });
      await shutdown;
    } finally {
      if (previousFfmpegPath === undefined) delete process.env.SERPENT_FFMPEG_PATH;
      else process.env.SERPENT_FFMPEG_PATH = previousFfmpegPath;
      if (previousOiioPath === undefined) delete process.env.SERPENT_OIIO_PATH;
      else process.env.SERPENT_OIIO_PATH = previousOiioPath;
    }
  });

  it('retries the worker spawn once when the first child exits before ready', async () => {
    utilityProcessFork.mockClear();
    const previousFfmpegPath = process.env.SERPENT_FFMPEG_PATH;
    const previousOiioPath = process.env.SERPENT_OIIO_PATH;
    process.env.SERPENT_FFMPEG_PATH = '/usr/bin/true';
    process.env.SERPENT_OIIO_PATH = '/usr/bin/true';
    try {
      const first = new FakeUtilityProcess();
      const second = new FakeUtilityProcess();
      utilityProcessFork
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second);
      const logger = {
        worker: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
      } as unknown as AppLogger;
      const client = new LibraryWorkerClient('/tmp/library-worker.js', logger);

      const start = client.start();
      first.emit('exit', 1);
      // The retry fork spans two microtask hops (reject → attempt throw →
      // loop retry); wait for the second fork instead of guessing turns.
      await vi.waitFor(() => {
        expect(utilityProcessFork).toHaveBeenCalledTimes(2);
      });
      second.emit('message', { type: 'worker.ready' });
      await start;

      expect(utilityProcessFork).toHaveBeenCalledTimes(2);
      expect(first.kill).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'worker.ready-retry',
        expect.any(String),
      );
    } finally {
      if (previousFfmpegPath === undefined) delete process.env.SERPENT_FFMPEG_PATH;
      else process.env.SERPENT_FFMPEG_PATH = previousFfmpegPath;
      if (previousOiioPath === undefined) delete process.env.SERPENT_OIIO_PATH;
      else process.env.SERPENT_OIIO_PATH = previousOiioPath;
    }
  });

  it('retries the worker spawn once when the ready handshake times out', async () => {
    vi.useFakeTimers();
    utilityProcessFork.mockClear();
    const previousFfmpegPath = process.env.SERPENT_FFMPEG_PATH;
    const previousOiioPath = process.env.SERPENT_OIIO_PATH;
    process.env.SERPENT_FFMPEG_PATH = '/usr/bin/true';
    process.env.SERPENT_OIIO_PATH = '/usr/bin/true';
    try {
      const first = new FakeUtilityProcess();
      const second = new FakeUtilityProcess();
      utilityProcessFork
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second);
      const logger = {
        worker: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
      } as unknown as AppLogger;
      const client = new LibraryWorkerClient('/tmp/library-worker.js', logger);

      const start = client.start();
      await vi.advanceTimersByTimeAsync(15_000);
      second.emit('message', { type: 'worker.ready' });
      await start;

      expect(first.kill).toHaveBeenCalled();
      expect(utilityProcessFork).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith(
        'worker.ready-timeout',
        expect.anything(),
        expect.objectContaining({ attempt: 1 }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        'worker.ready-retry',
        expect.any(String),
      );
    } finally {
      vi.useRealTimers();
      if (previousFfmpegPath === undefined) delete process.env.SERPENT_FFMPEG_PATH;
      else process.env.SERPENT_FFMPEG_PATH = previousFfmpegPath;
      if (previousOiioPath === undefined) delete process.env.SERPENT_OIIO_PATH;
      else process.env.SERPENT_OIIO_PATH = previousOiioPath;
    }
  });

  it('fails startup when both spawn attempts time out', async () => {
    vi.useFakeTimers();
    utilityProcessFork.mockClear();
    const previousFfmpegPath = process.env.SERPENT_FFMPEG_PATH;
    const previousOiioPath = process.env.SERPENT_OIIO_PATH;
    process.env.SERPENT_FFMPEG_PATH = '/usr/bin/true';
    process.env.SERPENT_OIIO_PATH = '/usr/bin/true';
    try {
      const first = new FakeUtilityProcess();
      const second = new FakeUtilityProcess();
      utilityProcessFork
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second);
      const logger = {
        worker: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
      } as unknown as AppLogger;
      const client = new LibraryWorkerClient('/tmp/library-worker.js', logger);

      const start = client.start();
      const startRejected = expect(start).rejects.toThrow('ready handshake timed out');
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.advanceTimersByTimeAsync(15_000);
      await startRejected;

      expect(utilityProcessFork).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith(
        'worker.ready-timeout',
        expect.anything(),
        expect.objectContaining({ attempt: 2 }),
      );
    } finally {
      vi.useRealTimers();
      if (previousFfmpegPath === undefined) delete process.env.SERPENT_FFMPEG_PATH;
      else process.env.SERPENT_FFMPEG_PATH = previousFfmpegPath;
      if (previousOiioPath === undefined) delete process.env.SERPENT_OIIO_PATH;
      else process.env.SERPENT_OIIO_PATH = previousOiioPath;
    }
  });
});
