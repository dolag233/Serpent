import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadAiImageInput } from '../../src/worker/ai/image-input';
import { ProviderConcurrencyLimiter } from '../../src/worker/ai/provider-concurrency-limiter';
import { AiProgressThrottler } from '../../src/worker/ai/progress-throttler';

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
});

describe('AiProgressThrottler', () => {
  it('emits at most once per second per library and keeps the latest snapshot', async () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const throttler = new AiProgressThrottler(emit);
    const base = { type: 'ai.progress' as const, libraryId: 'library-1', running: 0, succeeded: 0, failed: 0 };

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

  it('uploads a ready derivative with its explicit MIME and never requests a source path', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-ai-input-'));
    roots.push(root);
    const artifactPath = path.join(root, 'bounded.webp');
    writeFileSync(artifactPath, Buffer.from('bounded-512px-derivative'));
    const service = {
      getCurrentArtifact: vi.fn(() => ({ artifactId: 'artifact-1', mimeType: 'image/webp', status: 'ready' })),
      generateThumbnail: vi.fn(),
      getArtifactAbsolutePath: vi.fn(() => artifactPath),
    };

    const result = await loadAiImageInput(service, 'library-1', 'asset-1');

    expect(Buffer.from(result.imageBase64, 'base64').toString()).toBe('bounded-512px-derivative');
    expect(result.mime).toBe('image/webp');
    expect(service.generateThumbnail).not.toHaveBeenCalled();
    expect(service.getArtifactAbsolutePath).toHaveBeenCalledWith('library-1', 'artifact-1');
  });

  it('generates a bounded thumbnail when no ready derivative exists', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-ai-input-'));
    roots.push(root);
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

    const result = await loadAiImageInput(service, 'library-1', 'asset-1');

    expect(service.generateThumbnail).toHaveBeenCalledWith({ libraryId: 'library-1', assetId: 'asset-1' });
    expect(result).toMatchObject({ mime: 'image/png', artifactId: 'generated-1' });
  });
});
