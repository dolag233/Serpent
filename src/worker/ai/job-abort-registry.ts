export class AiJobAbortRegistry {
  private readonly active = new Map<string, { libraryId: string; controller: AbortController }>();

  register(libraryId: string, jobId: string): AbortController {
    const controller = new AbortController();
    this.active.set(jobId, { libraryId, controller });
    return controller;
  }

  unregister(jobId: string): void {
    this.active.delete(jobId);
  }

  abort(libraryId: string, jobIds?: string[]): void {
    const selected = jobIds ? new Set(jobIds) : undefined;
    for (const [jobId, active] of this.active) {
      if (active.libraryId !== libraryId || (selected && !selected.has(jobId))) continue;
      active.controller.abort();
    }
  }

  abortAll(): void {
    for (const active of this.active.values()) active.controller.abort();
    this.active.clear();
  }
}
