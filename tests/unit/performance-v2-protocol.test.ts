import { describe, expect, it } from 'vitest';

import { LibraryRequestBroker } from '../../src/main/library-request-broker';
import {
  DEFAULT_PERFORMANCE_CONSUMER_ID,
  MUTATION_RECEIPT_MAX_ENTITY_IDS,
  catalogReadVersionSchema,
  catalogSequenceFromBrowseChangeSequence,
  correlateBrokerRoundTrip,
  mutationReceiptSchema,
  performanceRequestEnvelopeSchema,
  performanceTimingReportSchema,
  resolveCatalogReadAdmission,
  summarizeTimingSamples,
  visibleImageDecodeCoverage,
} from '../../src/shared/performance-contract';
import { parseWorkerRequest } from '../../src/shared/protocol/requests';
import { workerResultSchema } from '../../src/shared/protocol/responses';

describe('PERF2-01 catalog version and mutation receipt protocol', () => {
  it('still parses Worker requests that omit the new envelope fields', () => {
    const parsed = parseWorkerRequest({
      requestId: 'request-legacy',
      command: {
        type: 'asset.list',
        libraryId: 'library-1',
        recursive: false,
      },
      performance: {
        lane: 'interactive-control',
        libraryId: 'library-1',
        libraryGeneration: 2,
        sentAtEpochMs: 10,
        interactionKey: 'browse',
        interactionGeneration: 4,
      },
    });

    expect(parsed.performance).toEqual({
      lane: 'interactive-control',
      libraryId: 'library-1',
      libraryGeneration: 2,
      sentAtEpochMs: 10,
      interactionKey: 'browse',
      interactionGeneration: 4,
    });
  });

  it('rejects invalid minCatalogSequence values', () => {
    expect(() => performanceRequestEnvelopeSchema.parse({
      lane: 'interactive-control',
      sentAtEpochMs: 1,
      minCatalogSequence: -1,
    })).toThrow();
    expect(() => performanceRequestEnvelopeSchema.parse({
      lane: 'interactive-control',
      sentAtEpochMs: 1,
      minCatalogSequence: 1.5,
    })).toThrow();
  });

  it('treats catalogSequence as the browse fence and admits minCatalogSequence', () => {
    expect(catalogSequenceFromBrowseChangeSequence(12)).toBe(12);
    expect(resolveCatalogReadAdmission(12, undefined)).toBe('ok');
    expect(resolveCatalogReadAdmission(12, 12)).toBe('ok');
    expect(resolveCatalogReadAdmission(11, 12)).toBe('stale');
    expect(catalogReadVersionSchema.parse({
      libraryGeneration: 3,
      catalogSequence: 12,
      snapshotGeneration: null,
    })).toMatchObject({
      libraryGeneration: 3,
      catalogSequence: 12,
      snapshotGeneration: null,
    });
  });

  it('rejects a mutation receipt that exceeds the bounded entity budget', () => {
    const tooMany = Array.from(
      { length: MUTATION_RECEIPT_MAX_ENTITY_IDS + 1 },
      (_, index) => `folder-${index}`,
    );
    expect(() => mutationReceiptSchema.parse({
      operationId: 'op-1',
      committedCatalogSequence: 4,
      changes: { affectedFolderIds: tooMany },
    })).toThrow();

    expect(mutationReceiptSchema.parse({
      operationId: 'op-1',
      historyEntryId: 'hist-1',
      committedCatalogSequence: 4,
      changes: {
        affectedFolderIds: ['folder-1'],
        folders: [{ folderId: 'folder-1' }],
      },
    })).toMatchObject({
      operationId: 'op-1',
      committedCatalogSequence: 4,
    });
  });

  it('stamps consumerId on Main envelopes without mixing window generations', () => {
    const broker = new LibraryRequestBroker();
    const first = broker.envelopeFor({
      type: 'media.get-preview-artifact',
      libraryId: 'library-1',
      assetId: 'asset-1',
    });
    const otherWindow = broker.envelopeFor({
      type: 'media.get-preview-artifact',
      libraryId: 'library-1',
      assetId: 'asset-1',
    }, { consumerId: 'window:secondary' });
    const sameWindow = broker.envelopeFor({
      type: 'media.get-preview-artifact',
      libraryId: 'library-1',
      assetId: 'asset-1',
    });

    expect(first.consumerId).toBe(DEFAULT_PERFORMANCE_CONSUMER_ID);
    expect(first.interactionGeneration).toBe(1);
    expect(otherWindow.consumerId).toBe('window:secondary');
    expect(otherWindow.interactionGeneration).toBe(1);
    expect(sameWindow.interactionGeneration).toBe(2);
  });

  it('correlates broker round trips from envelope send time', () => {
    expect(correlateBrokerRoundTrip({
      requestId: 'req-1',
      sentAtEpochMs: 1000,
      completedAtEpochMs: 1080,
    })).toEqual({
      requestId: 'req-1',
      sentAtEpochMs: 1000,
      completedAtEpochMs: 1080,
      roundTripMs: 80,
    });
  });

  it('separates timing phases and uses the visible-image set as decode denominator', () => {
    expect(performanceTimingReportSchema.parse({
      scenario: 'folder-switch',
      phase: 'persist',
      count: 3,
      p50Ms: 12,
      p95Ms: 20,
      maxMs: 21,
    }).phase).toBe('persist');
    expect(summarizeTimingSamples([10, 20, 30, 40])).toEqual({
      count: 4,
      p50Ms: 20,
      p95Ms: 40,
      maxMs: 40,
    });
    expect(visibleImageDecodeCoverage({
      expectedVisibleImageCount: 12,
      decodedCompleteNaturalWidthPositive: 9,
    })).toEqual({
      denominator: 12,
      decoded: 9,
      ratio: 0.75,
    });
  });

  it('accepts folder.created payloads without a receipt and with a bounded receipt', () => {
    const folder = {
      folderId: 'folder-1',
      parentFolderId: null,
      name: 'Props',
      relativePath: 'Props',
      directAssetCount: 0,
      childFolderCount: 0,
    };
    expect(workerResultSchema.parse({
      ok: true,
      type: 'folder.created',
      folder,
    })).toMatchObject({ type: 'folder.created' });

    expect(workerResultSchema.parse({
      ok: true,
      type: 'folder.created',
      folder,
      historyEntryId: 'hist-1',
      mutationReceipt: {
        operationId: 'hist-1',
        historyEntryId: 'hist-1',
        committedCatalogSequence: 9,
        changes: {
          folders: [folder],
          affectedFolderIds: ['folder-1'],
        },
      },
    })).toMatchObject({
      type: 'folder.created',
      mutationReceipt: { committedCatalogSequence: 9 },
    });
  });

  it('accepts browse.session.stale with catalog-sequence', () => {
    expect(workerResultSchema.parse({
      ok: true,
      type: 'browse.session.stale',
      sessionId: 'session-1',
      reason: 'catalog-sequence',
    })).toMatchObject({
      reason: 'catalog-sequence',
    });
  });
});
