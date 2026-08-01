import { describe, expect, it } from 'vitest';

import {
  PLUGIN_CAUSE_CHAIN_MAX_DEPTH,
  appendCauseChain,
  createPluginDomainEvent,
  createPluginDomainEventQueue,
  validatePluginCauseChain,
} from '../../src/plugins/plugin-domain-events';

describe('plugin domain events', () => {
  it('creates transport-safe events with stable ids', () => {
    const event = createPluginDomainEvent({
      kind: 'library.changed',
      libraryId: 'library-1',
      summary: { changeSequence: 3 },
    });
    expect(event.kind).toBe('library.changed');
    expect(event.libraryId).toBe('library-1');
    expect(event.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(event.summary).toEqual({ changeSequence: 3 });
    expect(event.causeChain).toEqual([]);
  });

  it('rejects cause chains that are too deep or cyclic', () => {
    const ids = Array.from({ length: PLUGIN_CAUSE_CHAIN_MAX_DEPTH + 1 }, () => crypto.randomUUID());
    expect(validatePluginCauseChain(ids).ok).toBe(false);
    const a = crypto.randomUUID();
    expect(validatePluginCauseChain([a, a]).ok).toBe(false);
    expect(validatePluginCauseChain([a]).ok).toBe(true);
  });

  it('appends cause chain entries until the depth limit', () => {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const appended = appendCauseChain([first], second);
    expect(appended).toEqual({ ok: true, causeChain: [first, second] });
  });

  it('delivers buffered events to waiters and closes with null', async () => {
    const queue = createPluginDomainEventQueue({ maxBuffered: 2 });
    const event = createPluginDomainEvent({
      kind: 'asset.changed',
      libraryId: 'library-1',
      summary: { changedCount: 1, missingCount: 0 },
    });
    queue.push(event);
    await expect(queue.next()).resolves.toMatchObject({ eventId: event.eventId });

    const waiting = queue.next();
    queue.push(createPluginDomainEvent({
      kind: 'library.changed',
      libraryId: 'library-1',
      summary: { changeSequence: 1 },
    }));
    await expect(waiting).resolves.toMatchObject({ kind: 'library.changed' });

    const closing = queue.next();
    queue.close();
    await expect(closing).resolves.toBeNull();
    await expect(queue.next()).resolves.toBeNull();
  });

  it('drops the oldest buffered event when the queue is full', async () => {
    const queue = createPluginDomainEventQueue({ maxBuffered: 1 });
    const first = createPluginDomainEvent({
      kind: 'library.changed',
      libraryId: 'library-1',
      summary: { changeSequence: 1 },
    });
    const second = createPluginDomainEvent({
      kind: 'library.changed',
      libraryId: 'library-1',
      summary: { changeSequence: 2 },
    });
    queue.push(first);
    queue.push(second);
    await expect(queue.next()).resolves.toMatchObject({ eventId: second.eventId });
  });
});
