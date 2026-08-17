import { describe, expect, it } from 'vitest';

import {
  LatestSearchRequestCoordinator,
  searchRequestLaneKey,
} from '../../src/worker/search-request-coordinator';

describe('LatestSearchRequestCoordinator', () => {
  it('coalesces requests independently per library and lane', () => {
    const coordinator = new LatestSearchRequestCoordinator();
    coordinator.mark('library-a', 'page', 'request-1');
    coordinator.mark('library-a', 'trash-count', 'request-2');
    coordinator.mark('library-b', 'page', 'request-3');
    expect(coordinator.isLatest('library-a', 'page', 'request-1')).toBe(true);
    expect(coordinator.isLatest('library-a', 'trash-count', 'request-2')).toBe(true);
    expect(coordinator.isLatest('library-b', 'page', 'request-3')).toBe(true);

    coordinator.mark('library-a', 'page', 'request-4');
    expect(coordinator.isLatest('library-a', 'page', 'request-1')).toBe(false);
    expect(coordinator.isLatest('library-a', 'page', 'request-4')).toBe(true);
    expect(coordinator.isLatest('library-a', 'trash-count', 'request-2')).toBe(true);
  });

  it('does not clear a newer request when an older one finishes', () => {
    const coordinator = new LatestSearchRequestCoordinator();
    coordinator.mark('library-a', 'page', 'request-1');
    coordinator.mark('library-a', 'page', 'request-2');
    coordinator.clearIfLatest('library-a', 'page', 'request-1');
    expect(coordinator.isLatest('library-a', 'page', 'request-2')).toBe(true);
    coordinator.clearIfLatest('library-a', 'page', 'request-2');
    expect(coordinator.isLatest('library-a', 'page', 'request-3')).toBe(true);
  });

  it('keeps parallel browse counters in separate lanes', () => {
    const page = searchRequestLaneKey({ limit: 50, offset: 0 });
    const libraryCount = searchRequestLaneKey({ limit: 1, offset: 0 });
    const trashCount = searchRequestLaneKey({
      scope: { kind: 'trash' },
      limit: 1,
      offset: 0,
    });
    expect(new Set([page, libraryCount, trashCount]).size).toBe(3);
  });

  it('isolates browse-window offsets while coalescing scope changes at one offset', () => {
    const firstFolder = searchRequestLaneKey({
      scope: { kind: 'folder', folderId: 'a', recursive: false },
      limit: 100,
      offset: 0,
    });
    const jumped = searchRequestLaneKey({
      scope: { kind: 'folder', folderId: 'a', recursive: false },
      limit: 100,
      offset: 500,
    });
    const otherFolder = searchRequestLaneKey({
      scope: { kind: 'folder', folderId: 'b', recursive: false },
      limit: 100,
      offset: 0,
    });
    expect(firstFolder).not.toBe(jumped);
    expect(firstFolder).toBe(otherFolder);
  });
});
