import {
  type PluginInstallControlAction,
  type PluginInstallProgress,
} from '../shared/plugin-install-progress';
import type { PluginGitHubDownloadOptions } from './plugin-package-manager-types';

export class PluginInstallCancelledError extends Error {
  constructor() {
    super('Plugin installation was stopped.');
    this.name = 'PluginInstallCancelledError';
  }
}

export class PluginInstallOperation {
  readonly operationId: string;
  readonly #abortController = new AbortController();
  readonly #report: (event: PluginInstallProgress) => void;
  #phase: PluginInstallProgress['phase'] = 'resolving';
  #state: PluginInstallProgress['state'] = 'running';
  #bytesDownloaded = 0;
  #totalBytes: number | undefined;
  #stopped = false;
  #resume: (() => void) | undefined;

  constructor(operationId: string, report: (event: PluginInstallProgress) => void) {
    this.operationId = operationId;
    this.#report = report;
    this.#emit();
  }

  get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  setPhase(phase: PluginInstallProgress['phase']): void {
    this.#phase = phase;
    this.#emit();
  }

  setCompleted(): void {
    if (this.#stopped) return;
    this.#state = 'completed';
    this.#emit();
  }

  setFailed(message: string): void {
    if (this.#stopped) return;
    this.#state = 'failed';
    this.#emit({ message: message.slice(0, 2_000) });
  }

  control(action: PluginInstallControlAction): void {
    if (this.#state === 'completed' || this.#state === 'failed' || this.#stopped) return;
    if (action === 'pause') {
      this.#state = 'paused';
      this.#emit();
      return;
    }
    if (action === 'resume') {
      this.#state = 'running';
      this.#resume?.();
      this.#resume = undefined;
      this.#emit();
      return;
    }
    this.#stopped = true;
    this.#state = 'stopped';
    this.#abortController.abort();
    this.#resume?.();
    this.#resume = undefined;
    this.#emit({ message: 'Plugin installation was stopped.' });
  }

  async waitIfPaused(): Promise<void> {
    if (this.#stopped) throw new PluginInstallCancelledError();
    if (this.#state !== 'paused') return;
    await new Promise<void>((resolve) => {
      this.#resume = resolve;
    });
    if (this.#stopped) throw new PluginInstallCancelledError();
  }

  downloadOptions(): PluginGitHubDownloadOptions {
    return {
      signal: this.signal,
      waitIfPaused: () => this.waitIfPaused(),
      onPhase: (phase) => this.setPhase(phase),
      onProgress: ({ bytesDownloaded, totalBytes }) => {
        this.#phase = 'downloading';
        this.#bytesDownloaded = bytesDownloaded;
        this.#totalBytes = totalBytes;
        this.#emit();
      },
    };
  }

  #emit(extra: Pick<PluginInstallProgress, 'message'> = {}): void {
    this.#report({
      operationId: this.operationId,
      phase: this.#phase,
      state: this.#state,
      bytesDownloaded: this.#bytesDownloaded,
      ...(this.#totalBytes === undefined ? {} : { totalBytes: this.#totalBytes }),
      ...extra,
    });
  }
}
