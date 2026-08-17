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

  it('routes a global plugin domain call through an explicit forLibrary target', async () => {
    const commands: Array<{ commandId: string; targetLibraryId?: string }> = [];
    const result = await runQuickJsSandboxPrototype(
      `
        const scoped = serpent.forLibrary('library-2');
        const page = await scoped.assets.search({ query: null, limit: 1 });
        return page.items.length;
      `,
      {
        executeAutomationCommand: async (commandId, _input, options) => {
          commands.push({
            commandId,
            ...(options?.targetLibraryId === undefined ? {} : { targetLibraryId: options.targetLibraryId }),
          });
          return { items: [{ assetId: 'asset-2' }], total: 1, offset: 0, limit: 1, hasMore: false };
        },
      },
    );

    expect(result.value).toBe(1);
    expect(commands).toEqual([{ commandId: 'asset.search', targetLibraryId: 'library-2' }]);
  });

  it('routes global plugin jobs through the same explicit forLibrary target', async () => {
    const enqueues: Array<{ handlerId: string; targetLibraryId?: string }> = [];
    const progress: Array<{ jobId: string; targetLibraryId?: string }> = [];
    const result = await runQuickJsSandboxPrototype(
      `
        const scoped = serpent.forLibrary('library-2');
        const job = await scoped.jobs.enqueue({ handlerId: 'upscale', payload: { assetId: 'asset-1' } });
        await scoped.jobs.reportProgress({ jobId: job.jobId, completed: 1, total: 1 });
        return job.jobId;
      `,
      {
        executeAutomationCommand: async () => ({ items: [], total: 0, offset: 0, limit: 0, hasMore: false }),
        waitForJobInvoke: async () => null,
        respondJobComplete: async () => {},
        enqueuePluginJob: async (input) => {
          enqueues.push({ handlerId: input.handlerId, ...(input.targetLibraryId === undefined ? {} : { targetLibraryId: input.targetLibraryId }) });
          return { jobId: '33333333-3333-4333-8333-333333333333' };
        },
        reportJobProgress: async (input) => {
          progress.push({ jobId: input.jobId, ...(input.targetLibraryId === undefined ? {} : { targetLibraryId: input.targetLibraryId }) });
        },
      },
    );

    expect(result.value).toBe('33333333-3333-4333-8333-333333333333');
    expect(enqueues).toEqual([{ handlerId: 'upscale', targetLibraryId: 'library-2' }]);
    expect(progress).toEqual([{ jobId: '33333333-3333-4333-8333-333333333333', targetLibraryId: 'library-2' }]);
  });

  it('exposes organize automation without leaking library or linked-folder paths to the script guest', async () => {
    const commands: Array<{ commandId: string; input: unknown }> = [];
    const result = await runQuickJsSandboxPrototype(
      `
        const library = await serpent.library.inspect();
        const linked = await serpent.linkedFolders.list();
        const tags = await serpent.tags.list();
        const created = await serpent.tags.create('天气-云');
        const assigned = await serpent.tags.assign(['asset-a'], [created.id]);
        const folder = await serpent.folders.create('天气');
        return {
          library,
          linked: linked.items[0],
          tag: tags.items[0],
          created,
          assigned,
          folder,
          hasLibraryPath: 'libraryPath' in library,
          hasAbsoluteRoot: 'absoluteRootPath' in linked.items[0],
        };
      `,
      {
        executeAutomationCommand: async (commandId, input) => {
          commands.push({ commandId, input });
          switch (commandId) {
            case 'library.inspect':
              return {
                libraryId: 'library-1',
                displayName: 'Temp',
                libraryPath: '/must-not-reach-script/Temp.serpentlibrary',
              };
            case 'linked-folder.list':
              return {
                items: [{
                  folderId: 'linked-a',
                  displayName: 'External',
                  status: 'available',
                  assetCount: 3,
                  absoluteRootPath: '/must-not-reach-script/external',
                  relativePath: '',
                  parentFolderId: null,
                }],
                total: 1,
                offset: 0,
                limit: 50,
                hasMore: false,
              };
            case 'tag.list':
              return {
                items: [{ tagId: 'tag-a', name: '概念', assetCount: 2 }],
                total: 1,
                offset: 0,
                limit: 50,
                hasMore: false,
              };
            case 'tag.create':
              return { id: 'tag-new', name: '天气-云', assetCount: 0 };
            case 'tag.assign':
              return { assignedCount: 1, skipped: [] };
            case 'folder.create':
              return { id: 'folder-new', parentId: null, name: '天气' };
            default:
              throw new Error(`Unexpected command ${commandId}`);
          }
        },
      },
    );

    expect(result.value).toEqual({
      library: { id: 'library-1', displayName: 'Temp' },
      linked: { id: 'linked-a', name: 'External', status: 'available', assetCount: 3 },
      tag: { id: 'tag-a', name: '概念', assetCount: 2 },
      created: { id: 'tag-new', name: '天气-云', assetCount: 0 },
      assigned: { assignedCount: 1, skipped: [] },
      folder: { id: 'folder-new', parentId: null, name: '天气' },
      hasLibraryPath: false,
      hasAbsoluteRoot: false,
    });
    expect(commands.map((entry) => entry.commandId)).toEqual([
      'library.inspect',
      'linked-folder.list',
      'tag.list',
      'tag.create',
      'tag.assign',
      'folder.create',
    ]);
  });

  it('exposes library.changeSequence for cross-process plan fencing without extra input', async () => {
    const commands: Array<{ commandId: string; input: unknown }> = [];
    const result = await runQuickJsSandboxPrototype(
      `
        const sequence = await serpent.library.changeSequence();
        return sequence;
      `,
      {
        executeAutomationCommand: async (commandId, input) => {
          commands.push({ commandId, input });
          expect(commandId).toBe('library.change-sequence');
          return { changeSequence: 7 };
        },
      },
    );

    expect(result.value).toEqual({ changeSequence: 7 });
    expect(commands).toEqual([{ commandId: 'library.change-sequence', input: {} }]);
  });

  it('exposes asset automation without leaking relative or absolute paths to the script guest', async () => {
    const commands: Array<{ commandId: string; input: unknown }> = [];
    const result = await runQuickJsSandboxPrototype(
      `
        const folders = await serpent.folders.list();
        const assets = await serpent.assets.list();
        const metadata = await serpent.assets.getMetadata(assets.items[0].id);
        const aiContent = await serpent.assets.getAiContent(assets.items[0].id);
        const copied = await serpent.assets.copyFilePaths(assets.items.map((asset) => asset.id));
        const renamed = await serpent.assets.renameFile(assets.items[0].id, 'first-tagged');
        const batchRenamed = await serpent.assets.renameFiles([{ assetId: assets.items[0].id, newBaseName: 'first-concept' }]);
        const read = await serpent.assets.readContent(assets.items[0].id, { maxBytes: 2 });
        const replaced = await serpent.assets.replaceContent(assets.items[0].id, 'AQID', { mimeHint: 'image/png' });
        const trashed = await serpent.assets.moveToTrash(assets.items.map((asset) => asset.id));
        const trash = await serpent.trash.list();
        const restored = await serpent.trash.restoreIfOriginalVacant(trash.items.map((asset) => asset.id));
        const palette = await serpent.palettes.mostFrequent({ days: 2, limit: 3 });
        return {
          first: assets.items[0],
          folder: folders.items[0],
          hasRelativePath: 'relativeFilePath' in assets.items[0],
          tag: metadata.tags[0].name,
          aiDescription: aiContent.description,
          aiTag: aiContent.tags[0],
          copied: copied.copiedCount,
          renamed: renamed.name,
          batchRenamed: batchRenamed.renamedCount,
          read: read.dataBase64,
          replaced: replaced.byteSize,
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
            case 'asset.ai-content.get':
              return {
                assetId: 'asset-a',
                description: 'AI description',
                tags: ['generated'],
                rating: 4,
                modelVersion: 'test-model',
              };
            case 'asset.paths.copy':
              return { copiedCount: 1 };
            case 'asset.rename-file':
              return { assetId: 'asset-a', name: 'first-tagged.png' };
            case 'asset.rename-files':
              return { renamedCount: 1, skipped: [] };
            case 'asset.content.replace':
              return { assetId: 'asset-a', revisionId: 'revision-b', byteSize: 3 };
            case 'asset.content.read':
              return {
                assetId: 'asset-a',
                revisionId: 'revision-a',
                byteSize: 4,
                dataBase64: 'AQI=',
                truncated: true,
                mimeType: 'image/png',
              };
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
      aiDescription: 'AI description',
      aiTag: 'generated',
      copied: 1,
      renamed: 'first-tagged.png',
      batchRenamed: 1,
      read: 'AQI=',
      replaced: 3,
      trashed: 1,
      restored: 1,
      color: '#112233',
    });
    expect(commands).toEqual([
      { commandId: 'folder.list', input: {} },
      { commandId: 'asset.list', input: {} },
      { commandId: 'asset.metadata.get', input: { assetId: 'asset-a' } },
      { commandId: 'asset.ai-content.get', input: { assetId: 'asset-a' } },
      { commandId: 'asset.paths.copy', input: { assetIds: ['asset-a'] } },
      { commandId: 'asset.rename-file', input: { assetId: 'asset-a', newBaseName: 'first-tagged' } },
      { commandId: 'asset.rename-files', input: { items: [{ assetId: 'asset-a', newBaseName: 'first-concept' }] } },
      {
        commandId: 'asset.content.read',
        input: { assetId: 'asset-a', maxBytes: 2 },
      },
      {
        commandId: 'asset.content.replace',
        input: { assetId: 'asset-a', dataBase64: 'AQID', mimeHint: 'image/png' },
      },
      { commandId: 'asset.trash', input: { assetIds: ['asset-a'] } },
      { commandId: 'asset.list-trash', input: {} },
      { commandId: 'asset.restore-if-original-vacant', input: { assetIds: ['asset-a'] } },
      { commandId: 'asset.palette.aggregate-recent', input: { days: 2, limit: 3 } },
    ]);
  });

  it('exposes headless library creation and file import through the same automation bridge', async () => {
    const commands: Array<{ commandId: string; input: unknown }> = [];
    const result = await runQuickJsSandboxPrototype(
      `
        const created = await serpent.library.create({
          displayName: 'Headless',
          selectedParentPath: '/private/parent',
        });
        const imported = await serpent.files.import({
          sourceKind: 'files',
          sourcePaths: ['/private/source.png'],
        });
        return { created, imported };
      `,
      {
        executeAutomationCommand: async (commandId, input) => {
          commands.push({ commandId, input });
          return commandId === 'library.create'
            ? { libraryId: 'library-1', displayName: 'Headless' }
            : { status: 'completed', completion: { importedCount: 1, skippedCount: 0, replacedCount: 0, assets: [] } };
        },
      },
    );

    expect(result.value).toEqual({
      created: { libraryId: 'library-1', displayName: 'Headless' },
      imported: { status: 'completed', completion: { importedCount: 1, skippedCount: 0, replacedCount: 0, assets: [] } },
    });
    expect(commands).toEqual([
      { commandId: 'library.create', input: { displayName: 'Headless', selectedParentPath: '/private/parent' } },
      { commandId: 'file.import', input: { sourceKind: 'files', sourcePaths: ['/private/source.png'] } },
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

  it('does not charge time spent awaiting a host call against the CPU budget', async () => {
    const delayedHost = {
      readText: async () => new Promise<string>((resolve) => {
        setTimeout(() => resolve('delayed'), 40);
      }),
    };
    await expect(
      runQuickJsSandboxPrototype('return await serpent.readText("wait");', delayedHost, {
        cpuTimeoutMs: 10,
        wallTimeoutMs: 250,
      }),
    ).resolves.toMatchObject({ value: 'delayed' });
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
