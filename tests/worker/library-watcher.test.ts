import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  type AssetObserverFactory,
  type DebounceScheduler,
} from '../../src/worker/library-service';

const temporaryRoots: string[] = [];

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

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('managed asset watcher', () => {
  it('starts on create/open and closes observers and timers with the library', () => {
    const root = temporaryRoot();
    const observers = observerHarness();
    const scheduler = new ManualScheduler();
    const service = new LibraryService({ observerFactory: observers.factory, scheduler });
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
    const service = new LibraryService({ observerFactory: observers.factory, scheduler });
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
    const events: unknown[] = [];
    const service = new LibraryService({
      observerFactory: observers.factory,
      scheduler,
      onAssetsChanged: (event) => events.push(event),
    });
    const library = service.createLibrary({ displayName: 'Overwrite', selectedParentPath: root });
    const plan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });
    const before = service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' }).assets[0]!;
    const managedPath = path.join(library.libraryPath, 'Assets', 'watched.png');
    writeFileSync(managedPath, 'second');
    const changedTime = new Date(Date.now() + 20_000);
    utimesSync(managedPath, changedTime, changedTime);

    observers.callbacks[0]!();
    scheduler.flush();

    const after = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
    expect(after.assetId).toBe(before.assetId);
    expect(after.currentRevisionId).not.toBe(before.currentRevisionId);
    expect(events).toEqual([
      { type: 'asset.changed', libraryId: library.libraryId, changedCount: 1, missingCount: 0 },
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
    const library = service.createLibrary({ displayName: 'Errors', selectedParentPath: root });
    observers.callbacks[0]!();
    expect(() => scheduler.flush()).not.toThrow();
    expect(diagnostics).toMatchObject([
      { scope: 'asset-watcher.refresh', error: { message: 'injected refresh failure' } },
    ]);

    service.closeLibrary(library.libraryId);
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
    const service = new LibraryService({
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

    const startService = new LibraryService({
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
    const service = new LibraryService({
      observerFactory: () => { throw new Error('watch failure'); },
      onDiagnostic: () => { throw new Error('diagnostic failure'); },
    });
    expect(() => service.createLibrary({ displayName: 'Best effort', selectedParentPath: root })).not.toThrow();
    service.closeAll();
  });
});
