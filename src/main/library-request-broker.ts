import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';
import {
  performanceInteractionKeyForCommand,
  performanceLaneForCommand,
  type PerformanceRequestEnvelope,
} from '../shared/performance-contract';

type RequestBrokerOptions = {
  sentAtEpochMs?: number;
  timeoutMs?: number | null;
};

/**
 * Main-owned metadata broker for the Library Worker boundary.
 *
 * The Renderer only expresses a domain command. This class is the single
 * place that turns that command into scheduling metadata and advances the
 * lifecycle generation after a Worker-owned open/close boundary completes.
 * Keeping the state here prevents individual Main callers from inventing
 * their own priority or stale-request rules.
 */
export class LibraryRequestBroker {
  #interactionGenerations = new Map<string, number>();
  #libraryGenerations = new Map<string, number>();

  envelopeFor(
    command: WorkerCommand,
    options: RequestBrokerOptions = {},
  ): PerformanceRequestEnvelope {
    const sentAtEpochMs = options.sentAtEpochMs ?? Date.now();
    const lane = performanceLaneForCommand(command);
    const interactionKey = performanceInteractionKeyForCommand(command);
    const libraryId = 'libraryId' in command && typeof command.libraryId === 'string'
      ? command.libraryId
      : undefined;
    const interactionGeneration = interactionKey === undefined
      ? undefined
      : this.nextInteractionGeneration(libraryId, interactionKey);
    const libraryGeneration = libraryId === undefined
      ? undefined
      : this.#libraryGenerations.get(libraryId);
    const deadlineAtEpochMs = options.timeoutMs == null
      ? undefined
      : sentAtEpochMs + options.timeoutMs;

    return {
      lane,
      sentAtEpochMs,
      ...(deadlineAtEpochMs === undefined ? {} : { deadlineAtEpochMs }),
      ...(libraryId === undefined ? {} : { libraryId }),
      ...(libraryGeneration === undefined ? {} : { libraryGeneration }),
      ...(interactionKey === undefined ? {} : { interactionKey }),
      ...(interactionGeneration === undefined ? {} : { interactionGeneration }),
    };
  }

  /** Apply a successful lifecycle boundary observed from the Worker. */
  observeResult(result: WorkerResult): void {
    if (!result.ok) return;
    switch (result.type) {
      case 'library.opened':
        this.advanceLibraryGeneration(result.library.libraryId);
        return;
      case 'library.closed':
      case 'library.deleted':
        this.advanceLibraryGeneration(result.libraryId);
        return;
      default:
        return;
    }
  }

  reset(): void {
    this.#interactionGenerations.clear();
    this.#libraryGenerations.clear();
  }

  private nextInteractionGeneration(libraryId: string | undefined, interactionKey: string): number {
    const key = `${libraryId ?? ''}\u0000${interactionKey}`;
    const generation = (this.#interactionGenerations.get(key) ?? 0) + 1;
    this.#interactionGenerations.set(key, generation);
    return generation;
  }

  private advanceLibraryGeneration(libraryId: string): void {
    this.#libraryGenerations.set(libraryId, (this.#libraryGenerations.get(libraryId) ?? 0) + 1);
  }
}
