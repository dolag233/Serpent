import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, type Page } from '@playwright/test';
import type { SerpentLibraryApi } from '../../src/shared/library-api';

type ProbeState = {
  promise: Promise<boolean>;
};

/** Exercise the actual draft connection test; no stored key/profile is read or saved. */
export async function probeAiConnectionContention(page: Page, libraryId: string): Promise<{
  holdMs: number;
  requests: number;
  createVisibleMs: number;
  createWhileNetworkPending: boolean;
  navigationMs: number;
  historyMs: number;
  statusesWhileNetworkPending: boolean;
}> {
  const holdMs = 5_000;
  let requests = 0;
  let sent = false;
  let response: ServerResponse | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let enteredTimer: ReturnType<typeof setTimeout> | undefined;
  let entered!: () => void;
  const networkEntered = new Promise<void>(resolve => { entered = resolve; });
  const server = createServer((request, currentResponse) => {
    request.resume();
    requests += 1;
    if (requests > 1) {
      currentResponse.writeHead(500, { 'content-type': 'application/json' });
      currentResponse.end('{}');
      return;
    }
    response = currentResponse;
    entered();
    holdTimer = setTimeout(() => {
      sent = true;
      currentResponse.writeHead(200, { 'content-type': 'application/json' });
      currentResponse.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }));
    }, holdMs);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    await page.evaluate(baseUrl => {
      const target = globalThis as typeof globalThis & {
        serpent: { library: SerpentLibraryApi };
        __serpentAiProbeContention?: ProbeState;
      };
      const promise = target.serpent.library.testAiConnection({
        apiFormat: 'openai_chat', model: 'fixture-probe', apiKey: 'fixture-key', baseUrl,
      }).then(result => result.ok && result.value.success);
      target.__serpentAiProbeContention = { promise };
    }, baseUrl);
    await Promise.race([
      networkEntered,
      new Promise<never>((_resolve, reject) => {
        enteredTimer = setTimeout(() => reject(new Error('The isolated network probe did not start.')), 12_000);
      }),
    ]);
    clearTimeout(enteredTimer);
    expect(sent).toBe(false);

    const statuses = page.evaluate(async libraryId => {
      const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
      const navigationStart = performance.now();
      const navigation = api.fetchLibraryNavigationSummary({ libraryId }).then(result => {
        if (!result.ok) throw new Error('Navigation snapshot failed during probe');
        return performance.now() - navigationStart;
      });
      const historyStart = performance.now();
      const history = api.getOperationHistoryStatus({ libraryId }).then(result => {
        if (!result.ok) throw new Error('History snapshot failed during probe');
        return performance.now() - historyStart;
      });
      const [navigationMs, historyMs] = await Promise.all([navigation, history]);
      return { navigationMs, historyMs };
    }, libraryId);
    let statusesWhileNetworkPending = false;
    const statusResult = statuses.then(result => {
      statusesWhileNetworkPending = !sent;
      return result;
    });
    // Attach a failure handler immediately while the independently measured UI
    // mutation runs; the awaited promise below still preserves the failure.
    void statusResult.catch(() => undefined);
    await page.getByRole('button', { name: '添加文件夹', exact: true }).click();
    const input = page.locator('.nav-inline-edit input');
    await expect(input).toBeVisible();
    await input.fill('CreatedDuringConnectionProbe');
    const createStart = Date.now();
    await input.press('Enter');
    await expect(page.locator('.navigation-pane .nav-row-label')
      .filter({ hasText: /^CreatedDuringConnectionProbe$/ })).toBeVisible({ timeout: 20_000 });
    const createVisibleMs = Date.now() - createStart;
    const createWhileNetworkPending = !sent;
    const timings = await statusResult;
    const probeSuccess = await page.evaluate(async () => {
      const state = (globalThis as typeof globalThis & { __serpentAiProbeContention?: ProbeState })
        .__serpentAiProbeContention;
      if (!state) throw new Error('Missing isolated probe state');
      return state.promise;
    });
    expect(probeSuccess).toBe(true);
    expect(requests).toBe(1);
    if (process.env.SERPENT_REAL_NAV_ASSERT_AI_NONBLOCKING === '1') {
      expect(createWhileNetworkPending, 'Create must finish while the provider response is still held').toBe(true);
      expect(statusesWhileNetworkPending, 'Status reads must finish before the provider response').toBe(true);
    }
    return { holdMs, requests, createVisibleMs, createWhileNetworkPending,
      ...timings, statusesWhileNetworkPending };
  } finally {
    clearTimeout(holdTimer);
    clearTimeout(enteredTimer);
    response?.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await page.evaluate(async () => {
      const target = globalThis as typeof globalThis & { __serpentAiProbeContention?: ProbeState };
      await target.__serpentAiProbeContention?.promise.catch(() => undefined);
      delete target.__serpentAiProbeContention;
    });
  }
}
