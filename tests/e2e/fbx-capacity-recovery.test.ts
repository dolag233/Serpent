import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, realpath, rm, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type ElectronApplication } from '@playwright/test';
import sharp from 'sharp';

import type { SerpentLibraryApi } from '../../src/shared/library-api';
import { launchBenchmarkApp, readSessionLog, summarizeTimings } from './perf-bench-helpers';

const source = process.env.SERPENT_FBX_CAPACITY_SOURCE;
test.skip(!source, 'Provide a read-only large FBX to exercise native offscreen rendering.');
test.setTimeout(120_000);

async function cleanupOwnedApplication(input: {
  application: ElectronApplication | undefined;
  launchAttempted: boolean;
  root: string;
  ownedRoot: string;
  workspace: string;
}): Promise<void> {
  const { application, launchAttempted, root, ownedRoot, workspace } = input;
  if (application) {
    const child = application.process();
    const exited = child.exitCode !== null || child.signalCode !== null;
    const exit = exited ? Promise.resolve() : once(child, 'exit');
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      application.evaluate(({ app }) => app.quit()).catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 2000); }),
    ]);
    clearTimeout(timer);
    const graceful = await Promise.race([
      exit.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 15_000); }),
    ]);
    clearTimeout(timer);
    if (!graceful && child.pid && child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
      const forced = await Promise.race([
        exit.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 5000); }),
      ]);
      clearTimeout(timer);
      if (!forced) throw new Error('Owned test process did not exit');
    }
    if (child.exitCode === null && child.signalCode === null) throw new Error('Owned test process is still alive');
    await Promise.race([
      application.close().catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); }),
    ]);
    clearTimeout(timer);
  } else if (launchAttempted) throw new Error('Launch failed before owned process could be verified; fixture retained');
  if (await realpath(root) !== ownedRoot || path.dirname(ownedRoot) !== workspace) {
    throw new Error('Owned cleanup boundary changed');
  }
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}

test('keeps browsing responsive when a large source FBX thumbnail settles', async () => {
  if (!source) return;
  const sourcePath = await realpath(source);
  const workspace = await realpath(process.cwd());
  const disk = await statfs(workspace);
  if (disk.bavail * disk.bsize < 3 * 1024 ** 3) throw new Error('Insufficient isolated test space');
  const sourceHash = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
  const root = await mkdtemp(path.join(workspace, '.tmp-fbx-capacity-'));
  const ownedRoot = await realpath(root);
  const imagePath = path.join(root, 'capacity-image.png');
  let application: ElectronApplication | undefined;
  let launchAttempted = false;
  try {
    await writeFile(imagePath, await sharp({ create: {
      width: 2049, height: 64, channels: 3, background: { r: 65, g: 115, b: 160 },
    } }).png().toBuffer());
    launchAttempted = true;
    const launched = await launchBenchmarkApp({
      userDataPath: path.join(root, 'profile'),
      extraEnv: {
        SERPENT_E2E_HIDE_WINDOW: '1',
        SERPENT_E2E_CREATE_PARENT_PATH: root,
        SERPENT_E2E_IMPORT_FILES: [sourcePath, imagePath].join(path.delimiter),
      },
    });
    application = launched.application;
    const page = launched.window;
    expect(await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(window => window.isVisible()))).toBe(false);
    await page.getByRole('button', { name: '创建资源库', exact: true }).click();
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('Capacity recovery');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.locator('.workspace-canvas').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: '导入文件', exact: true }).first().click();
    const imageCard = page.locator('.asset-card').filter({ hasText: 'capacity-image.png' });
    await expect(imageCard).toBeVisible({ timeout: 30_000 });
    const libraryId = await page.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
      const result = await api.listOpen();
      if (!result.ok || !result.value[0]) throw new Error('Missing isolated library');
      return result.value[0].libraryId;
    });
    const latencies: number[] = [];
    let runningSamples = 0;
    let modelAttempts = 0;
    let modelStatus: string | undefined;

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const sample = await page.evaluate(async (libraryId) => {
        const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
        const jobs = await api.listMediaJobs({ libraryId, limit: 100 });
        if (!jobs.ok) throw new Error('Could not read isolated jobs');
        const model = jobs.value.jobs.find(job => job.kind === 'generate_thumbnail' && /\.fbx$/iu.test(job.assetName ?? ''));
        const start = performance.now();
        const assets = await api.listAssets({ libraryId, recursive: true });
        if (!assets.ok) throw new Error('Browse request failed');
        return { latency: performance.now() - start, status: model?.status,
          errorCode: model?.errorCode, attempts: model?.attemptCount ?? 0 };
      }, libraryId);
      latencies.push(sample.latency);
      if (sample.status === 'running') runningSamples += 1;
      modelStatus = sample.status;
      modelAttempts = sample.attempts;
      if (sample.status === 'failed' || sample.status === 'succeeded') {
        expect(sample.errorCode ?? '').not.toMatch(/^FBX_/u);
        break;
      }
      await page.waitForTimeout(50);
    }
    expect(['failed', 'succeeded']).toContain(modelStatus);
    expect(modelAttempts).toBeGreaterThan(0);
    await expect.poll(async () => imageCard.locator('img').evaluateAll(images => images.some(image =>
      image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)),
    { timeout: 15_000 }).toBe(true);
    const artifactDir = path.join(root, 'Capacity recovery', '.serpent', 'artifacts');
    expect((await readdir(artifactDir)).some(name => name.endsWith('.model_glb'))).toBe(false);
    console.log(JSON.stringify({ fbxCapacity: {
      sourceBytes: (await readFile(sourcePath)).byteLength, modelAttempts, runningSamples,
      browseLatencyMs: summarizeTimings(latencies), modelStatus,
      processes: await application.evaluate(({ app }) => app.getAppMetrics().map(metric => ({
        type: metric.type, privateMiB: metric.memory.privateBytes === undefined
          ? null : Math.round(metric.memory.privateBytes / 1024),
      }))),
    } }));
    expect(createHash('sha256').update(await readFile(sourcePath)).digest('hex')).toBe(sourceHash);
  } catch (error) {
    const diagnostics = readSessionLog(path.join(root, 'profile')).split('\n').flatMap(line => {
      try {
        const row = JSON.parse(line) as { scope?: string; error?: { name?: string; code?: string; message?: string; cause?: unknown } };
        return row.scope?.includes('model-thumbnail.orchestrate') || row.scope?.includes('media-job.failed')
          ? [{ scope: row.scope, error: row.error }] : [];
      } catch { return []; }
    }).slice(-4);
    console.log(JSON.stringify({ isolatedFbxFailureDiagnostics: diagnostics }));
    throw error;
  } finally {
    await cleanupOwnedApplication({ application, launchAttempted, root, ownedRoot, workspace });
  }
});
