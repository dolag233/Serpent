import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUICKJS_SANDBOX_PROTOTYPE_LIMITS,
  QuickJsSandboxPrototypeError,
  runQuickJsSandboxPrototype,
  transpileQuickJsSandboxPrototypeSource,
} from '../../src/scripting/quickjs-sandbox-prototype';

const echoHost = {
  readText: async (input: string) => `host:${input}`,
};

async function expectSandboxFailure(
  source: string,
  code: QuickJsSandboxPrototypeError['code'],
  limits?: Parameters<typeof runQuickJsSandboxPrototype>[2],
): Promise<void> {
  await expect(runQuickJsSandboxPrototype(source, echoHost, limits)).rejects.toMatchObject({ code });
}

describe('QuickJS/WASM sandbox engine prototype', () => {
  it('transpiles TypeScript and resumes an async host bridge without Node globals', async () => {
    const result = await runQuickJsSandboxPrototype(
      `
        const message: string = await serpent.readText('hello');
        console.log(message);
        return message.toUpperCase();
      `,
      echoHost,
    );

    expect(result.value).toBe('HOST:HELLO');
    expect(result.output).toEqual(['"host:hello"']);
    expect(result.transpiledJavaScript).not.toContain(': string');
  });

  it('exposes only fixed asset automation methods through the asynchronous host bridge', async () => {
    const commands: Array<{ commandId: string; input: unknown }> = [];
    const result = await runQuickJsSandboxPrototype(
      `
        const page = await serpent.assets.search({ query: 'Ser', limit: 2, offset: 0 });
        return await serpent.assets.setRating(page.items.map((asset) => asset.id), 4);
      `,
      {
        executeAutomationCommand: async (commandId, input) => {
          commands.push({ commandId, input });
          if (commandId === 'asset.search') {
            return {
              items: [{ assetId: 'asset-a' }, { assetId: 'asset-b' }],
              total: 2,
              offset: 0,
              limit: 50,
              hasMore: false,
            };
          }
          return { updatedCount: 2, skipped: [] };
        },
      },
    );

    expect(result.value).toEqual({ updatedCount: 2, skipped: [] });
    expect(commands).toEqual([
      { commandId: 'asset.search', input: { query: 'Ser', limit: 2, offset: 0 } },
      { commandId: 'asset.rating.set', input: { assetIds: ['asset-a', 'asset-b'], rating: 4 } },
    ]);
  });

  it('exposes asset automation without leaking relative or absolute paths to the script guest', async () => {
    const commands: Array<{ commandId: string; input: unknown }> = [];
    const result = await runQuickJsSandboxPrototype(
      `
        const folders = await serpent.folders.list();
        const assets = await serpent.assets.list();
        const metadata = await serpent.assets.getMetadata(assets.items[0].id);
        const copied = await serpent.assets.copyFilePaths(assets.items.map((asset) => asset.id));
        const renamed = await serpent.assets.renameFile(assets.items[0].id, 'first-tagged');
        const batchRenamed = await serpent.assets.renameFiles([{ assetId: assets.items[0].id, newBaseName: 'first-concept' }]);
        const trashed = await serpent.assets.moveToTrash(assets.items.map((asset) => asset.id));
        const trash = await serpent.trash.list();
        const restored = await serpent.trash.restoreIfOriginalVacant(trash.items.map((asset) => asset.id));
        const palette = await serpent.palettes.mostFrequent({ days: 2, limit: 3 });
        return {
          first: assets.items[0],
          folder: folders.items[0],
          hasRelativePath: 'relativeFilePath' in assets.items[0],
          tag: metadata.tags[0].name,
          copied: copied.copiedCount,
          renamed: renamed.name,
          batchRenamed: batchRenamed.renamedCount,
          trashed: trashed.trashedCount,
          restored: restored.restoredCount,
          color: palette.colors[0].hex,
        };
      `,
      {
        executeAutomationCommand: async (commandId, input) => {
          commands.push({ commandId, input });
          switch (commandId) {
            case 'folder.list':
              return {
                items: [{
                  folderId: 'folder-a',
                  parentFolderId: null,
                  name: 'References',
                  relativePath: 'References',
                  directAssetCount: 1,
                  childFolderCount: 0,
                }],
                total: 1,
                offset: 0,
                limit: 50,
                hasMore: false,
              };
            case 'asset.list':
            case 'asset.list-trash':
              return {
                items: [{
                  assetId: 'asset-a',
                  displayName: 'first.png',
                  relativeFilePath: '/must-not-reach-script/first.png',
                  rating: 4,
                  favorite: true,
                  locationKind: 'managed',
                  managedFolderId: 'folder-a',
                }],
                total: 1,
                offset: 0,
                limit: 50,
                hasMore: false,
              };
            case 'asset.metadata.get':
              return { assetId: 'asset-a', tags: [{ id: 'tag-a', name: 'concept', source: 'user' }] };
            case 'asset.paths.copy':
              return { copiedCount: 1 };
            case 'asset.rename-file':
              return { assetId: 'asset-a', name: 'first-tagged.png' };
            case 'asset.rename-files':
              return { renamedCount: 1, skipped: [] };
            case 'asset.trash':
              return { trashedCount: 1 };
            case 'asset.restore-if-original-vacant':
              return { restoredCount: 1, skippedCount: 0, skipped: [] };
            case 'asset.palette.aggregate-recent':
              return {
                days: 2,
                assetCount: 1,
                paletteAssetCount: 1,
                colors: [{ hex: '#112233', weight: 1, assetCount: 1 }],
              };
            default:
              throw new Error(`Unexpected command ${commandId}`);
          }
        },
      },
    );

    expect(result.value).toEqual({
      first: {
        id: 'asset-a', name: 'first.png', rating: 4, favorite: true, locationKind: 'managed', folderId: 'folder-a',
      },
      folder: { id: 'folder-a', parentId: null, name: 'References' },
      hasRelativePath: false,
      tag: 'concept',
      copied: 1,
      renamed: 'first-tagged.png',
      batchRenamed: 1,
      trashed: 1,
      restored: 1,
      color: '#112233',
    });
    expect(commands).toEqual([
      { commandId: 'folder.list', input: {} },
      { commandId: 'asset.list', input: {} },
      { commandId: 'asset.metadata.get', input: { assetId: 'asset-a' } },
      { commandId: 'asset.paths.copy', input: { assetIds: ['asset-a'] } },
      { commandId: 'asset.rename-file', input: { assetId: 'asset-a', newBaseName: 'first-tagged' } },
      { commandId: 'asset.rename-files', input: { items: [{ assetId: 'asset-a', newBaseName: 'first-concept' }] } },
      { commandId: 'asset.trash', input: { assetIds: ['asset-a'] } },
      { commandId: 'asset.list-trash', input: {} },
      { commandId: 'asset.restore-if-original-vacant', input: { assetIds: ['asset-a'] } },
      { commandId: 'asset.palette.aggregate-recent', input: { days: 2, limit: 3 } },
    ]);
  });

  it('does not expose process, require, Node built-ins, environment, filesystem, or network', async () => {
    const result = await runQuickJsSandboxPrototype(
      `
        return {
          process: typeof process,
          require: typeof require,
          environment: typeof process === 'undefined' ? 'unavailable' : typeof process.env,
          filesystem: typeof require === 'undefined' ? 'unavailable' : typeof require('node:fs'),
          network: typeof fetch,
          functionConstructor: typeof Function,
          reflection: typeof Reflect,
          asyncFunctionConstructor: typeof (async () => undefined).constructor,
        };
      `,
      echoHost,
    );

    expect(result.value).toEqual({
      process: 'undefined',
      require: 'undefined',
      environment: 'unavailable',
      filesystem: 'unavailable',
      network: 'undefined',
      functionConstructor: 'undefined',
      reflection: 'undefined',
      asyncFunctionConstructor: 'undefined',
    });
  });

  it('rejects static and direct dynamic imports before evaluation', async () => {
    try {
      transpileQuickJsSandboxPrototypeSource(`import fs from 'node:fs';`);
      throw new Error('Expected the module import to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(QuickJsSandboxPrototypeError);
      expect(error).toMatchObject({ code: 'SOURCE_NOT_ALLOWED' });
    }
    await expectSandboxFailure(`return import('node:fs');`, 'SOURCE_NOT_ALLOWED');
  });

  it('bounds source before TypeScript transpilation and serializes ES2022 BigInt values safely', async () => {
    await expectSandboxFailure(
      ' '.repeat(DEFAULT_QUICKJS_SANDBOX_PROTOTYPE_LIMITS.maxSourceBytes + 1),
      'SOURCE_TOO_LARGE',
    );

    await expect(runQuickJsSandboxPrototype('console.log(1n); return 1n;', echoHost)).resolves.toMatchObject({
      value: 1n,
      output: ['1n'],
    });
  });

  it('rejects dynamic code construction and reflective constructor escape hatches', async () => {
    await expectSandboxFailure(`return await eval("import('node:' + 'fs')");`, 'SOURCE_NOT_ALLOWED');
    await expectSandboxFailure(`return Function('return 1')();`, 'SOURCE_NOT_ALLOWED');
  });

  it('interrupts an infinite loop and a separate execution remains healthy', async () => {
    await expectSandboxFailure('while (true) {}', 'CPU_TIMEOUT', { cpuTimeoutMs: 20 });

    await expect(runQuickJsSandboxPrototype('return 6 * 7;', echoHost)).resolves.toMatchObject({ value: 42 });
  });

  it('rejects guest memory growth within the configured QuickJS runtime limit', async () => {
    await expectSandboxFailure(
      `
        const values = [];
        while (true) values.push('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      `,
      'MEMORY_LIMIT',
      { memoryLimitBytes: 256 * 1024, cpuTimeoutMs: 500 },
    );
  });

  it('caps script output and pending asynchronous host calls', async () => {
    await expectSandboxFailure(`console.log('x'.repeat(100)); return 'done';`, 'OUTPUT_LIMIT', {
      maxOutputBytes: 32,
    });
    await expectSandboxFailure(
      `
        const first = serpent.readText('one');
        const second = serpent.readText('two');
        return await Promise.all([first, second]);
      `,
      'HOST_CALL_LIMIT',
      { maxPendingHostCalls: 1 },
    );
  });

  it('terminates a promise microtask storm with a bounded job-advancement budget', async () => {
    await expectSandboxFailure(
      `
        function storm() { Promise.resolve().then(storm); }
        storm();
        return await new Promise(() => undefined);
      `,
      'PROMISE_LIMIT',
      { cpuTimeoutMs: 500, wallTimeoutMs: 500, maxPendingJobBatches: 3 },
    );
  });

  it('hard-caps guest-created unfinished promises independently of the job-pump budget', async () => {
    await expectSandboxFailure(
      `
        const pending = [];
        for (let index = 0; index < 5; index += 1) {
          pending.push(new Promise(() => undefined));
        }
        return pending.length;
      `,
      'PROMISE_LIMIT',
      { maxPendingGuestPromises: 4, maxPendingJobBatches: 100 },
    );
  });

  it('does not charge already-settled promises against the unfinished-promise budget', async () => {
    await expect(
      runQuickJsSandboxPrototype(
        `
          for (let index = 0; index < 100; index += 1) {
            Promise.resolve(index);
          }
          return 'settled';
        `,
        echoHost,
        { maxPendingGuestPromises: 1, maxPendingJobBatches: 200 },
      ),
    ).resolves.toMatchObject({ value: 'settled' });
  });

  it('counts concurrent async function invocations and releases their budget after settlement', async () => {
    const slowHost = {
      readText: async (input: string) => new Promise<string>((resolve) => {
        setTimeout(() => resolve(`slow:${input}`), 5);
      }),
    };
    await expect(
      runQuickJsSandboxPrototype(
        `
          async function load(value) {
            return await serpent.readText(value);
          }
          const first = load('one');
          const second = load('two');
          return await Promise.all([first, second]);
        `,
        slowHost,
        { maxPendingGuestPromises: 2, wallTimeoutMs: 500 },
      ),
    ).rejects.toMatchObject({ code: 'PROMISE_LIMIT' });

    await expect(
      runQuickJsSandboxPrototype(
        `
          async function load(value) {
            return await serpent.readText(value);
          }
          const values = [];
          for (const value of ['one', 'two', 'three', 'four', 'five']) {
            values.push(await load(value));
          }
          return values;
        `,
        slowHost,
        { maxPendingGuestPromises: 4, wallTimeoutMs: 500 },
      ),
    ).resolves.toMatchObject({
      value: ['slow:one', 'slow:two', 'slow:three', 'slow:four', 'slow:five'],
    });
  });

  it('times out an unresolved host promise and leaves a fresh execution usable', async () => {
    const neverResolvingHost = { readText: async () => new Promise<string>(() => undefined) };
    await expect(
      runQuickJsSandboxPrototype('return await serpent.readText("wait");', neverResolvingHost, {
        wallTimeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: 'WALL_TIMEOUT' });

    await expect(runQuickJsSandboxPrototype('return "still alive";', echoHost)).resolves.toMatchObject({
      value: 'still alive',
    });
  });

  it('honours cancellation while awaiting an untrusted script host call', async () => {
    const controller = new AbortController();
    const neverResolvingHost = { readText: async () => new Promise<string>(() => undefined) };
    const execution = runQuickJsSandboxPrototype(
      'return await serpent.readText("wait");',
      neverResolvingHost,
      { signal: controller.signal, wallTimeoutMs: 500 },
    );
    setTimeout(() => controller.abort(), 10);
    await expect(execution).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
