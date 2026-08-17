import { describe, expect, it } from 'vitest';

import { createScriptRuntimeUtilityHandler } from '../../src/scripting/script-runtime-utility';
import type { ScriptRuntimeChildMessage } from '../../src/shared/script-runtime-utility-protocol';

async function waitForMessage(
  messages: readonly ScriptRuntimeChildMessage[],
  predicate: (message: ScriptRuntimeChildMessage) => boolean,
): Promise<ScriptRuntimeChildMessage> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const message = messages.find(predicate);
    if (message !== undefined) return message;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for the Script Runtime Utility message.');
}

describe('Script Runtime Utility handler', () => {
  it('runs QuickJS in the utility contract and proxies only declared automation commands', async () => {
    const messages: ScriptRuntimeChildMessage[] = [];
    const handler = createScriptRuntimeUtilityHandler({ postMessage: (message) => messages.push(message) });
    handler.handle({
      type: 'script-runtime.run',
      executionId: 'execution-a',
      source: `
        const page = await serpent.assets.search({ query: 'Ser', limit: 2 });
        return page.items.map((asset) => asset.name);
      `,
    });

    const hostCommand = await waitForMessage(messages, (message) => message.type === 'script-runtime.host-command');
    if (hostCommand.type !== 'script-runtime.host-command') throw new Error('Expected a host command.');
    expect(hostCommand).toMatchObject({
      executionId: 'execution-a',
      commandId: 'asset.search',
      input: { query: 'Ser', limit: 2 },
    });
    handler.handle({
      type: 'script-runtime.host-result',
      executionId: hostCommand.executionId,
      requestId: hostCommand.requestId,
      ok: true,
      result: {
        items: [{ assetId: 'asset-a', displayName: 'Ser-reference.png', rating: 0, favorite: false, locationKind: 'managed' }],
        total: 1,
        offset: 0,
        limit: 2,
        hasMore: false,
      },
    });
    const completed = await waitForMessage(messages, (message) => message.type === 'script-runtime.completed');
    expect(completed).toMatchObject({
      executionId: 'execution-a',
      value: ['Ser-reference.png'],
    });
    handler.dispose();
  });

  it('cancels an awaiting host call without accepting a late host result', async () => {
    const messages: ScriptRuntimeChildMessage[] = [];
    const handler = createScriptRuntimeUtilityHandler({ postMessage: (message) => messages.push(message) });
    handler.handle({
      type: 'script-runtime.run',
      executionId: 'execution-b',
      source: `return await serpent.assets.search({ query: 'wait' });`,
    });
    const hostCommand = await waitForMessage(messages, (message) => message.type === 'script-runtime.host-command');
    if (hostCommand.type !== 'script-runtime.host-command') throw new Error('Expected a host command.');
    handler.handle({ type: 'script-runtime.abort', executionId: 'execution-b' });
    handler.handle({
      type: 'script-runtime.host-result',
      executionId: hostCommand.executionId,
      requestId: hostCommand.requestId,
      ok: true,
      result: { items: [], total: 0, offset: 0, limit: 50, hasMore: false },
    });
    const failed = await waitForMessage(messages, (message) => message.type === 'script-runtime.failed');
    expect(failed).toMatchObject({ executionId: 'execution-b', code: 'CANCELLED' });
    handler.dispose();
  });

  it('makes the stable Host error code available to script catch handlers', async () => {
    const messages: ScriptRuntimeChildMessage[] = [];
    const handler = createScriptRuntimeUtilityHandler({ postMessage: (message) => messages.push(message) });
    handler.handle({
      type: 'script-runtime.run',
      executionId: 'execution-catch-error',
      source: `
        try {
          await serpent.assets.search({ query: null });
          return 'unexpected success';
        } catch (error) {
          return { code: error.code, message: error.message };
        }
      `,
    });
    const hostCommand = await waitForMessage(messages, (message) => message.type === 'script-runtime.host-command');
    if (hostCommand.type !== 'script-runtime.host-command') throw new Error('Expected a host command.');
    handler.handle({
      type: 'script-runtime.host-result',
      executionId: hostCommand.executionId,
      requestId: hostCommand.requestId,
      ok: false,
      error: {
        code: 'AUTOMATION_CAPABILITY_DENIED',
        message: 'The automation execution has not been granted the required capability.',
      },
    });
    const completed = await waitForMessage(messages, (message) => message.type === 'script-runtime.completed');
    expect(completed).toMatchObject({
      executionId: 'execution-catch-error',
      value: {
        code: 'AUTOMATION_CAPABILITY_DENIED',
        message: 'The automation execution has not been granted the required capability.',
      },
    });
    handler.dispose();
  });
});
