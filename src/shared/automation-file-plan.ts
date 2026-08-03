import { createHash } from 'node:crypto';

export type AutomationFilePlanOperation =
  | 'trash'
  | 'replace-content'
  | 'move'
  | 'rename-file'
  | 'rename-files'
  | 'restore-if-original-vacant';

export type AutomationFilePlanRenameItem = {
  assetId: string;
  newBaseName: string;
};

export type AutomationFilePlanHashInput = {
  operation: AutomationFilePlanOperation;
  assetIds: readonly string[];
  targetFolderId?: string | null;
  newBaseName?: string;
  renameItems?: readonly AutomationFilePlanRenameItem[];
  conflictStrategy?: 'keep-both' | 'replace' | 'skip';
  expectedChangeSequence: number;
  assetStates: readonly { assetId: string; stateToken: string }[];
  resolutionFacts?: readonly {
    assetId: string;
    outcome: 'execute' | 'blocked' | 'no-op';
    destination?: string;
    conflict?: boolean;
  }[];
};

export type AutomationImportPlanHashInput = {
  sourceKind: 'files' | 'folder';
  sourcePaths: readonly string[];
  targetFolderId?: string;
  imageSequenceFps?: number;
  expandImageSequences?: boolean;
  expectedChangeSequence: number;
  sourceStates: readonly { sourcePath: string; stateToken: string }[];
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/**
 * Hash only the Worker-verifiable operation intent and preflight state. The
 * execution id is deliberately excluded: an approved plan is bound to the
 * requested operation, current library fence and opaque asset states, not to
 * whichever transport happened to request it.
 */
export function createAutomationFilePlanHash(input: AutomationFilePlanHashInput): string {
  return sha256({
    schema: 'serpent.automation-file-plan.v2',
    operation: input.operation,
    assetIds: [...input.assetIds],
    targetFolderId: input.targetFolderId ?? null,
    newBaseName: input.newBaseName ?? null,
    renameItems: input.renameItems === undefined ? null : [...input.renameItems],
    conflictStrategy: input.conflictStrategy ?? null,
    expectedChangeSequence: input.expectedChangeSequence,
    assetStates: [...input.assetStates],
    resolutionFacts: input.resolutionFacts === undefined ? null : [...input.resolutionFacts],
  });
}

export function createAutomationImportPlanHash(input: AutomationImportPlanHashInput): string {
  return sha256({
    schema: 'serpent.automation-import-plan.v2',
    sourceKind: input.sourceKind,
    sourcePaths: [...input.sourcePaths],
    targetFolderId: input.targetFolderId ?? null,
    imageSequenceFps: input.imageSequenceFps ?? null,
    expandImageSequences: input.expandImageSequences ?? null,
    expectedChangeSequence: input.expectedChangeSequence,
    sourceStates: [...input.sourceStates],
  });
}
