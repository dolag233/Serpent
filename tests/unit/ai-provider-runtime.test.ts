import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadAiImageInput, encodeAiAnalysisImage, type AiAnalysisSharpFactory } from '../../src/worker/ai/image-input';
import { ProviderConcurrencyLimiter } from '../../src/worker/ai/provider-concurrency-limiter';
import { runLimitedAiRequest } from '../../src/worker/ai/limited-request';
import { AiProgressThrottler } from '../../src/worker/ai/progress-throttler';
import {
  DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX,
  normalizeAiAnalysisImageEdgePx,
} from '../../src/shared/ai-analysis-image';

describe('normalizeAiAnalysisImageEdgePx', () => {
  it('defaults to 2048 (2K) and clamps to 512–4096', () => {
    expect(normalizeAiAnalysisImageEdgePx(undefined)).toBe(DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX);
    expect(normalizeAiAnalysisImageEdgePx(100)).toBe(512);
    expect(normalizeAiAnalysisImageEdgePx(9999)).toBe(4096);
    expect(normalizeAiAnalysisImageEdgePx(1536)).toBe(1536);
  });
});

describe('ProviderConcurrencyLimiter', () => {
  it('caps one provider at two active requests across libraries', async () => {
    const limiter = new ProviderConcurrencyLimiter(2);
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const task = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    });

    const requests = [
      limiter.run('openai', undefined, task), // library A
      limiter.run('openai', undefined, task), // library B
      limiter.run('openai', undefined, task), // library C waits
    ];
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(2));
    expect(maximum).toBe(2);
    releases.shift()?.();
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(3));
    releases.splice(0).forEach((release) => release());
    await Promise.all(requests);
    expect(maximum).toBe(2);
  });

  it('removes an aborted request while it waits for a provider slot', async () => {
    const limiter = new ProviderConcurrencyLimiter(1);
    let release!: () => void;
    const first = limiter.run('gemini', undefined, () => new Promise<void>((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const waiting = limiter.run('gemini', controller.signal, async () => undefined);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await first;
  });

  it('enforces one global cap across providers and applies a lower limit without interrupting running requests', async () => {
    const limiter = new ProviderConcurrencyLimiter(2);
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const task = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    };

    const first = limiter.run('openai', undefined, task);
    const second = limiter.run('gemini', undefined, task);
    const third = limiter.run('anthropic', undefined, task);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(maximum).toBe(2);

    limiter.setLimit(1);
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));

    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await Promise.all([first, second, third]);
    expect(maximum).toBe(2);
  });

  it('admits waiting requests immediately when the live cap is raised to sixteen', async () => {
    const limiter = new ProviderConcurrencyLimiter(1);
    const releases: Array<() => void> = [];
    const task = vi.fn(async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
    });
    const requests = Array.from(
      { length: 16 },
      (_, index) => limiter.run(index % 2 === 0 ? 'openai' : 'dashscope', undefined, task),
    );

    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
    limiter.setLimit(16);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(16));
    expect(limiter.snapshot()).toEqual({
      inFlight: 16,
      limit: 16,
      waitingForSlot: 0,
    });
    releases.splice(0).forEach((release) => release());
    await Promise.all(requests);
  });

  it('starts the request timeout after, not while waiting for, a global slot', async () => {
    const limiter = new ProviderConcurrencyLimiter(1);
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const first = runLimitedAiRequest(
      limiter,
      'openai',
      undefined,
      15,
      async () => {
        firstStarted();
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      },
    );
    await new Promise<void>((resolve) => { firstStarted = resolve; });

    let secondSignal!: AbortSignal;
    const second = runLimitedAiRequest(
      limiter,
      'dashscope',
      undefined,
      15,
      async (signal) => {
        secondSignal = signal;
        return 'sent-after-wait';
      },
    );
    // A caller's configured request timeout must not expire while this task
    // only waits for the global semaphore.
    await new Promise((resolve) => setTimeout(resolve, 30));
    releaseFirst();
    await expect(second).resolves.toBe('sent-after-wait');
    expect(secondSignal.aborted).toBe(false);
    await first;
  });
});

describe('AiProgressThrottler', () => {
  it('emits at most once per second per library and keeps the latest snapshot', async () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const throttler = new AiProgressThrottler(emit);
    const base = {
      type: 'ai.progress' as const,
      libraryId: 'library-1',
      running: 0,
      succeeded: 0,
      failed: 0,
    };

    throttler.publish({ ...base, queued: 3 });
    throttler.publish({ ...base, queued: 2, running: 1 });
    throttler.publish({ ...base, queued: 1, running: 2 });
    expect(emit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(emit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ queued: 1, running: 2 }));

    throttler.clearAll();
    vi.useRealTimers();
  });
});

describe('loadAiImageInput', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('encodes the source path under the max edge and never reads the thumbnail', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-ai-input-'));
    roots.push(root);
    const sourcePath = path.join(root, 'source.png');
    writeFileSync(sourcePath, Buffer.from('source-pixels'));
    const service = {
      getCurrentArtifact: vi.fn(),
      generateThumbnail: vi.fn(),
      getArtifactAbsolutePath: vi.fn(),
    };
    const sharpFn = vi.fn(() => {
      const chain = {
        rotate: vi.fn(),
        resize: vi.fn(),
        jpeg: vi.fn(),
        toBuffer: vi.fn(async () => Buffer.from('resized-jpeg')),
      };
      chain.rotate.mockReturnValue(chain);
      chain.resize.mockReturnValue(chain);
      chain.jpeg.mockReturnValue(chain);
      return chain;
    }) as unknown as AiAnalysisSharpFactory;

    const result = await loadAiImageInput(service, 'library-1', 'asset-1', {
      sourcePath,
      maxEdgePx: 2048,
      sharpFn,
    });

    expect(result).toEqual({
      imageBase64: Buffer.from('resized-jpeg').toString('base64'),
      mime: 'image/jpeg',
    });
    expect(service.getCurrentArtifact).not.toHaveBeenCalled();
    expect(service.generateThumbnail).not.toHaveBeenCalled();
    expect(sharpFn).toHaveBeenCalledWith(sourcePath);
  });

  it('falls back to the ready thumbnail when source encode fails', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-ai-input-'));
    roots.push(root);
    const sourcePath = path.join(root, 'broken.exr');
    writeFileSync(sourcePath, Buffer.from('not-an-image'));
    const artifactPath = path.join(root, 'bounded.webp');
    writeFileSync(artifactPath, Buffer.from('bounded-512px-derivative'));
    const service = {
      getCurrentArtifact: vi.fn(() => ({
        artifactId: 'artifact-1',
        mimeType: 'image/webp',
        status: 'ready',
      })),
      generateThumbnail: vi.fn(),
      getArtifactAbsolutePath: vi.fn(() => artifactPath),
    };
    let call = 0;
    const sharpFn = vi.fn((input: string | Buffer) => {
      call += 1;
      if (call === 1) {
        throw new Error('unsupported format');
      }
      const chain = {
        rotate: vi.fn(),
        resize: vi.fn(),
        jpeg: vi.fn(),
        toBuffer: vi.fn(async () => Buffer.from('thumb-jpeg')),
      };
      chain.rotate.mockReturnValue(chain);
      chain.resize.mockReturnValue(chain);
      chain.jpeg.mockReturnValue(chain);
      expect(Buffer.isBuffer(input)).toBe(true);
      return chain;
    }) as unknown as AiAnalysisSharpFactory;

    const result = await loadAiImageInput(service, 'library-1', 'asset-1', {
      sourcePath,
      maxEdgePx: 1024,
      sharpFn,
    });

    expect(result).toMatchObject({
      mime: 'image/jpeg',
      artifactId: 'artifact-1',
      imageBase64: Buffer.from('thumb-jpeg').toString('base64'),
    });
    expect(service.generateThumbnail).not.toHaveBeenCalled();
  });

  it('generates a thumbnail when source fails and no ready derivative exists', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-ai-input-'));
    roots.push(root);
    const sourcePath = path.join(root, 'broken.exr');
    writeFileSync(sourcePath, Buffer.from('not-an-image'));
    const artifactPath = path.join(root, 'generated.png');
    writeFileSync(artifactPath, Buffer.from('generated-thumbnail'));
    const getCurrentArtifact = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ artifactId: 'generated-1', mimeType: 'image/png', status: 'ready' });
    const service = {
      getCurrentArtifact,
      generateThumbnail: vi.fn().mockResolvedValue({ artifactId: 'generated-1' }),
      getArtifactAbsolutePath: vi.fn(() => artifactPath),
    };
    let call = 0;
    const sharpFn = vi.fn(() => {
      call += 1;
      if (call === 1) throw new Error('unsupported');
      const chain = {
        rotate: vi.fn(),
        resize: vi.fn(),
        jpeg: vi.fn(),
        toBuffer: vi.fn(async () => Buffer.from('generated-jpeg')),
      };
      chain.rotate.mockReturnValue(chain);
      chain.resize.mockReturnValue(chain);
      chain.jpeg.mockReturnValue(chain);
      return chain;
    }) as unknown as AiAnalysisSharpFactory;

    const result = await loadAiImageInput(service, 'library-1', 'asset-1', {
      sourcePath,
      sharpFn,
    });

    expect(service.generateThumbnail).toHaveBeenCalledWith({
      libraryId: 'library-1',
      assetId: 'asset-1',
    });
    expect(result).toMatchObject({
      mime: 'image/jpeg',
      artifactId: 'generated-1',
    });
  });
});

describe('encodeAiAnalysisImage', () => {
  it('passes withoutEnlargement and the requested edge into sharp', async () => {
    const resize = vi.fn();
    const chain = {
      rotate: vi.fn(),
      resize,
      jpeg: vi.fn(),
      toBuffer: vi.fn(async () => Buffer.from('out')),
    };
    chain.rotate.mockReturnValue(chain);
    resize.mockReturnValue(chain);
    chain.jpeg.mockReturnValue(chain);
    const sharpFn = vi.fn(() => chain) as unknown as AiAnalysisSharpFactory;

    await encodeAiAnalysisImage(Buffer.from('in'), 2048, sharpFn);

    expect(resize).toHaveBeenCalledWith({
      width: 2048,
      height: 2048,
      fit: 'inside',
      withoutEnlargement: true,
    });
  });
});
