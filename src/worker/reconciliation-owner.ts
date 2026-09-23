/**
 * One cancellable open/watcher/network reconciliation owner per library.
 * Generation stays after the task map entry is cleared so deferred open
 * maintenance can still fence the same open generation.
 */
export type LibraryReconciliationReason = 'open' | 'watcher' | 'network';

export type LibraryReconciliationTask<TOpenLibrary = unknown> = {
  controller: AbortController;
  generation: number;
  libraryId: string;
  openLibrary: TOpenLibrary;
  promise: Promise<void>;
  reason: LibraryReconciliationReason;
  triggerScope?: string;
  linkedFolderIds?: string[];
  /** Existing linked source paths proven by precise native file-change events. */
  linkedFilePathsByFolder?: Map<string, Set<string>>;
  /**
   * Serpent-be29a9: release the scheduler's background admission at a safe
   * point and take it back before the next batch. Supplied by the Worker, which
   * owns the scheduler; absent for reconciliations the Worker did not schedule.
   */
  admissionYield?: () => Promise<void>;
};

export type RegisterLibraryReconciliationInput<TOpenLibrary> = {
  libraryId: string;
  openLibrary: TOpenLibrary;
  reason: LibraryReconciliationReason;
  triggerScope?: string;
  linkedFolderIds?: string[];
  linkedFilePathsByFolder?: Map<string, Set<string>>;
  admissionYield?: () => Promise<void>;
};

export class LibraryReconciliationOwner<TOpenLibrary = unknown> {
  private readonly tasks = new Map<string, LibraryReconciliationTask<TOpenLibrary>>();
  private readonly generations = new Map<string, number>();

  current(libraryId: string): LibraryReconciliationTask<TOpenLibrary> | undefined {
    return this.tasks.get(libraryId);
  }

  generation(libraryId: string): number | undefined {
    return this.generations.get(libraryId);
  }

  isCurrent(task: LibraryReconciliationTask<TOpenLibrary>): boolean {
    return this.tasks.get(task.libraryId) === task;
  }

  abort(libraryId: string): void {
    this.tasks.get(libraryId)?.controller.abort();
  }

  register(
    input: RegisterLibraryReconciliationInput<TOpenLibrary>,
  ): LibraryReconciliationTask<TOpenLibrary> {
    const generation = (this.generations.get(input.libraryId) ?? 0) + 1;
    this.generations.set(input.libraryId, generation);
    const task: LibraryReconciliationTask<TOpenLibrary> = {
      controller: new AbortController(),
      generation,
      libraryId: input.libraryId,
      openLibrary: input.openLibrary,
      promise: Promise.resolve(),
      reason: input.reason,
      ...(input.triggerScope === undefined ? {} : { triggerScope: input.triggerScope }),
      ...(input.linkedFolderIds === undefined ? {} : { linkedFolderIds: input.linkedFolderIds }),
      ...(input.linkedFilePathsByFolder === undefined
        ? {}
        : { linkedFilePathsByFolder: input.linkedFilePathsByFolder }),
      ...(input.admissionYield === undefined ? {} : { admissionYield: input.admissionYield }),
    };
    this.tasks.set(input.libraryId, task);
    return task;
  }

  clearIfCurrent(task: LibraryReconciliationTask<TOpenLibrary>): void {
    if (this.tasks.get(task.libraryId) === task) {
      this.tasks.delete(task.libraryId);
    }
  }

  abortError(): Error {
    const error = new Error('Open-library reconciliation was cancelled.');
    error.name = 'AbortError';
    return error;
  }
}
