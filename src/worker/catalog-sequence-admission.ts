import {
  catalogSequenceFromBrowseChangeSequence,
  resolveCatalogReadAdmission,
} from '../shared/performance-contract';
import type { WorkerResult } from '../shared/protocol/responses';

export function browseCatalogSequenceStale(
  sessionId: string,
  changeSequence: number,
  minCatalogSequence: number | undefined,
): Extract<WorkerResult, { type: 'browse.session.stale' }> | undefined {
  if (resolveCatalogReadAdmission(
    catalogSequenceFromBrowseChangeSequence(changeSequence),
    minCatalogSequence,
  ) !== 'stale') {
    return undefined;
  }
  return {
    ok: true,
    type: 'browse.session.stale',
    sessionId,
    reason: 'catalog-sequence',
  };
}
