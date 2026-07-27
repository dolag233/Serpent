import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  type AssetObserverFactory,
  type DebounceScheduler,
} from '../../src/worker/library-service';

const temporaryRoots: string[] = [];
const services: LibraryService[] = [];

function newService(
  ...args: ConstructorParameters<typeof LibraryService>
): LibraryService {
  const service = new LibraryService(...args);
  services.push(service);
  return service;
}

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-watcher-test-'));
  temporaryRoots.push(root);
  return root;
}

class ManualScheduler implements DebounceScheduler {
  private nextId = 1;
  private readonly tasks = new Map<number, () => void>();
  readonly cancelled: number[] = [];
  readonly scheduled: number[] = [];

  cancel(handle: unknown): void {
    const id = handle as number;
    this.cancelled.push(id);
    this.tasks.delete(id);
  }

  flush(): void {
    const tasks = [...this.tasks.values()];
    this.tasks.clear();
    for (const task of tasks) task();
  }

  pendingCount(): number {
    return this.tasks.size;
  }

  schedule(callback: () => void): unknown {
    const id = this.nextId++;
    this.scheduled.push(id);
    this.tasks.set(id, callback);
    return id;
  }
}

function observerHarness() {
  const callbacks: Array<() => void> = [];
  const errorCallbacks: Array<(error: unknown) => void> = [];
  const closed: number[] = [];
  const roots: string[] = [];
  const factory: AssetObserverFactory = (rootPath, onEvent, onError) => {
    const index = callbacks.length;
    roots.push(rootPath);
    callbacks.push(onEvent);
    errorCallbacks.push(onError);
    return { close: () => closed.push(index) };
  };
  return { callbacks, closed, errorCallbacks, factory, roots };
}

/**
 * Controllable clock for the client-mutation watcher-notification suppression
 * window. Import/resolve are client-initiated filesystem mutations, so the
 * service suppresses watcher "disk synced" notifications for `debounceMs * 6`
 * after them (real wall-clock seconds). Tests drive the debounce scheduler
 * manually and would otherwise sit inside that window; advancing this clock
 * past it keeps them deterministic without wall-clock sleeps.
 */
function watchClock(startMs = 1_000_000) {
  let current = startMs;
  return {
    advance: (ms: number) => {
      current += ms;
    },
    clock: { now: () => current },
  };
}

afterEach(() => {
  for (const service of services.splice(0)) {
    service.closeAll();
  }
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 });
  }
});

describe('managed asset watcher', () => {
  it('starts on create/open and closes observers and timers with the library', () => {
    const root = temporaryRoot();
    const observers = observerHarness();
    const scheduler = new ManualScheduler();
    const service = newService({ observerFactory: observers.factory, scheduler });
    const library = service.createLibrary({ displayName: 'Observed', selectedParentPath: root });

    expect(observers.roots).toEqual([path.join(library.libraryPath, 'Assets')]);
    observers.callbacks[0]!();
    expect(scheduler.pendingCount()).toBe(1);
    service.closeLibrary(library.libraryId);
    expect(observers.closed).toEqual([0]);
    expect(scheduler.pendingCount()).toBe(0);

    service.openLibrary(library.libraryPath);
    expect(observers.roots).toHaveLength(2);
    service.closeAll();
    expect(observers.closed).toEqual([0, 1]);
  });

  it('coalesces event storms and derives deletion from a debounced stat refresh', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'watched.png');
    writeFileSync(source, 'watched');
    const observers = observerHarness();
    const scheduler = new ManualScheduler();
    const service = newService({ observerFactory: observers.factory, scheduler });
    const library = service.createLibrary({ displayName: 'Storm', selectedParentPath: root });
    const plan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });
    service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' });
    rmSync(path.join(library.libraryPath, 'Assets', 'watched.png'));

    observers.callbacks[0]!();
    observers.callbacks[0]!();
    observers.callbacks[0]!();
    expect(scheduler.scheduled).toHaveLength(3);
    expect(scheduler.cancelled).toHaveLength(2);
    expect(scheduler.pendingCount()).toBe(1);
    scheduler.flush();

    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })[0]?.availability).toBe('missing');
    service.closeAll();
  });

  it('ignores event payload meaning and derives overwrite from current stat', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'watched.png');
    writeFileSync(source, 'first');
    const observers = observerHarness();
    const scheduler = new ManualScheduler();
    const { advance, clock } = watchClock();
    const events: unknown[] = [];
    const service = newService({
      observerFactory: observers.factory,
      scheduler,
      watchNotifyClock: clock,
      onAssetsChanged: (event) => events.push(event),
    });
    const library = service.createLibrary({ displayName: 'Overwrite', selectedParentPath: root });
    const plan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });
    const before = service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' }).assets[0]!;
    events.length = 0;
    const managedPath = path.join(library.libraryPath, 'Assets', 'watched.png');
    writeFileSync(managedPath, 'second');
    const changedTime = new Date(Date.now() + 20_000);
    utimesSync(managedPath, changedTime, changedTime);
    // The import above is a client mutation: advance past the suppression
    // window so this external overwrite is reported as a watcher change.
    advance(10_000);

    observers.callbacks[0]!();
    scheduler.flush();

    const after = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
    expect(after.assetId).toBe(before.assetId);
    expect(after.currentRevisionId).not.toBe(before.currentRevisionId);
    expect(events).toEqual([
      { type: 'asset.changed', libraryId: library.libraryId, changedCount: 1, missingCount: 0, source: 'watcher' },
    ]);
    observers.callbacks[0]!();
    scheduler.flush();
    expect(events).toHaveLength(1);
    service.closeAll();
  });

  it('does not schedule after close and swallows refresh errors', () => {
    const root = temporaryRoot();
    const observers = observerHarness();
    const scheduler = new ManualScheduler();
    class ThrowingRefreshService extends LibraryService {
      override refreshManagedAssets(): never {
        throw new Error('injected refresh failure');
      }
    }
    const diagnostics: Array<{ scope: string; error: unknown }> = [];
    const service = new ThrowingRefreshService({
      observerFactory: observers.factory,
      scheduler,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    services.push(service);
    service.createLibrary({ displayName: 'Errors', selectedParentPath: root });
    observers.callbacks[0]!();
    expect(() => scheduler.flush()).not.toThrow();
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'open.refresh-managed-assets',
          error: expect.objectContaining({ message: 'injected refresh failure' }),
        }),
        expect.objectContaining({
          scope: 'asset-watcher.refresh',
          error: expect.objectContaining({ message: 'injected refresh failure' }),
        }),
      ]),
    );

    service.closeAll();
    observers.callbacks[0]!();
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('reports native observer, startup, scheduler, and close failures without changing library lifecycle', () => {
    const root = temporaryRoot();
    const causes = {
      native: new Error('native watch failure'),
      schedule: new Error('scheduler failure'),
      close: new Error('observer close failure'),
      start: new Error('observer start failure'),
    };
    const diagnostics: Array<{ scope: string; error: unknown; context?: Record<string, unknown> }> = [];
    const observers = observerHarness();
    const scheduler: DebounceScheduler = {
      cancel: () => undefined,
      schedule: () => { throw causes.schedule; },
    };
    const service = newService({
      observerFactory: (assetsPath, onEvent, onError) => {
        const observer = observers.factory(assetsPath, onEvent, onError);
        return { close: () => { observer.close(); throw causes.close; } };
      },
      scheduler,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const library = service.createLibrary({ displayName: 'Diagnostics', selectedParentPath: root });

    observers.errorCallbacks[0]!(causes.native);
    expect(() => observers.callbacks[0]!()).not.toThrow();
    expect(() => service.closeLibrary(library.libraryId)).not.toThrow();

    const startService = newService({
      observerFactory: () => { throw causes.start; },
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const unobserved = startService.createLibrary({ displayName: 'Startup', selectedParentPath: root });
    expect(() => startService.closeLibrary(unobserved.libraryId)).not.toThrow();

    expect(diagnostics.map(({ scope, error }) => ({ scope, error }))).toEqual([
      { scope: 'asset-watcher.error', error: causes.native },
      { scope: 'asset-watcher.schedule', error: causes.schedule },
      { scope: 'asset-watcher.close', error: causes.close },
      { scope: 'asset-watcher.start', error: causes.start },
    ]);
    expect(diagnostics[0]?.context).toMatchObject({ libraryId: library.libraryId });
  });

  it('ignores diagnostic callback failures', () => {
    const root = temporaryRoot();
    const service = newService({
      observerFactory: () => { throw new Error('watch failure'); },
      onDiagnostic: () => { throw new Error('diagnostic failure'); },
    });
    expect(() => service.createLibrary({ displayName: 'Best effort', selectedParentPath: root })).not.toThrow();
    service.closeAll();
  });

  it('discovers new files in a managed folder after a debounced event', () => {
    const root = temporaryRoot();
    const observers = observerHarness();
    const scheduler = new ManualScheduler();
    const events: unknown[] = [];
    const service = newService({
      observerFactory: observers.factory,
      scheduler,
      onAssetsChanged: (event) => events.push(event),
    });
    const library = service.createLibrary({ displayName: 'Managed watch', selectedParentPath: root });
    const folder = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'FolderA',
    });

    writeFileSync(path.join(library.libraryPath, 'Assets', folder.relativePath, 'added-a.png'), 'a');
    writeFileSync(path.join(library.libraryPath, 'Assets', folder.relativePath, 'added-b.png'), 'b');
    observers.callbacks[0]!();
    observers.callbacks[0]!();
    expect(scheduler.pendingCount()).toBe(1);
    scheduler.flush();

    expect(service.listAssets({
      libraryId: library.libraryId,
      folderId: folder.folderId,
      recursive: false,
    }).map((asset) => asset.relativeFilePath).sort()).toEqual([
      'FolderA/added-a.png',
      'FolderA/added-b.png',
    ]);
    expect(events).toEqual([
      { type: 'asset.changed', libraryId: library.libraryId, changedCount: 2, missingCount: 0, source: 'watcher' },
    ]);
    service.closeAll();
  });
});

describe('linked folder watcher', () => {
  it('starts one observer per available root and discovers new files after a debounced event', () => {
    const root = temporaryRoot();
    const linkedRoot = path.join(root, 'linked');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'existing.png'), 'existing');
    const observers = observerHarness();
    const scheduler = new ManualScheduler();
    const events: unknown[] = [];
    const service = newService({
      observerFactory: observers.factory,
      scheduler,
      onAssetsChanged: (event) => events.push(event),
    });
    const library = service.createLibrary({ displayName: 'Linked watch', selectedParentPath: root });
    const linked = service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: linkedRoot,
    });
    expect(service.refreshManagedAssets(library.libraryId).changedCount).toBe(0);

    expect(observers.roots).toEqual([
      path.join(library.libraryPath, 'Assets'),
      realpathSync(linkedRoot),
    ]);

    mkdirSync(path.join(linkedRoot, 'new'));
    writeFileSync(path.join(linkedRoot, 'new', 'added.png'), 'added');
    observers.callbacks[1]!();
    observers.callbacks[1]!();
    expect(scheduler.pendingCount()).toBe(1);
    scheduler.flush();

    expect(service.listAssets({
      libraryId: library.libraryId,
      folderId: linked.folderId,
      recursive: true,
    }).map((asset) => asset.relativeFilePath).sort()).toEqual([
      'existing.png',
      'new/added.png',
    ]);
    expect(events).toEqual([
      { type: 'asset.changed', libraryId: library.libraryId, changedCount: 1, missingCount: 0, source: 'watcher' },
    ]);
    service.closeAll();
    expect(observers.closed.sort()).toEqual([0, 1]);

    service.openLibrary(library.libraryPath);
    expect(observers.roots.slice(2)).toEqual([
      path.join(library.libraryPath, 'Assets'),
      realpathSync(linkedRoot),
    ]);
    service.closeAll();
    expect(observers.closed.sort()).toEqual([0, 1, 2, 3]);
  });

  it('stops offline roots, restarts returned roots, and rebuilds an observer on relink', () => {
    const root = temporaryRoot();
    const linkedRoot = path.join(root, 'linked');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'a.png'), 'a');
    const observers = observerHarness();
    const service = newService({ observerFactory: observers.factory });
    const library = service.createLibrary({ displayName: 'Lifecycle', selectedParentPath: root });
    const linked = service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: linkedRoot,
    });

    rmSync(linkedRoot, { force: true, recursive: true });
    service.refreshManagedAssets(library.libraryId);
    expect(observers.closed).toContain(1);

    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'a.png'), 'returned');
    service.refreshManagedAssets(library.libraryId);
    expect(observers.roots).toEqual([
      path.join(library.libraryPath, 'Assets'),
      realpathSync(linkedRoot),
      realpathSync(linkedRoot),
    ]);

    rmSync(linkedRoot, { force: true, recursive: true });
    service.refreshManagedAssets(library.libraryId);
    const relocated = path.join(root, 'relocated');
    mkdirSync(relocated);
    writeFileSync(path.join(relocated, 'a.png'), 'relocated');
    service.relinkMissingFolder({
      libraryId: library.libraryId,
      folderId: linked.folderId,
      newRootPath: relocated,
    });
    expect(observers.roots.at(-1)).toBe(realpathSync(relocated));
    service.closeAll();
    expect(observers.closed).toContain(observers.roots.length - 1);
  });

  it('ignores default entries and symlinks discovered after import and emits a diagnostic', () => {
    const root = temporaryRoot();
    const linkedRoot = path.join(root, 'linked');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'existing.png'), 'existing');
    const observers = observerHarness();
    const scheduler = new ManualScheduler();
    const diagnostics: Array<{ scope: string; context?: Record<string, unknown> }> = [];
    const service = newService({
      observerFactory: observers.factory,
      scheduler,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const library = service.createLibrary({ displayName: 'Ignore', selectedParentPath: root });
    const linked = service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: linkedRoot });

    mkdirSync(path.join(linkedRoot, '.git'));
    writeFileSync(path.join(linkedRoot, '.git', 'config'), 'ignored');
    writeFileSync(path.join(linkedRoot, '.DS_Store'), 'ignored');
    writeFileSync(path.join(root, 'outside.png'), 'outside');
    symlinkSync(path.join(root, 'outside.png'), path.join(linkedRoot, 'link.png'));
    observers.callbacks[1]!();
    scheduler.flush();

    expect(service.listAssets({
      libraryId: library.libraryId,
      folderId: linked.folderId,
      recursive: true,
    }).map((asset) => asset.relativeFilePath)).toEqual(['existing.png']);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      scope: 'linked-folder.symlink-skipped',
      context: expect.objectContaining({ linkedFolderId: linked.folderId }),
    }));
    service.closeAll();
  });
});
