/**
 * Import conflict dialog orchestration (Serpent-zp8q).
 * Name conflicts and content duplicates are separate phases.
 */

import type { ImportConflictPlan } from '../shared/protocol/responses';
import type {
  ImportConflictPreferences,
  RememberedDuplicateDecision,
  RememberedNameConflictDecision,
} from './import-conflict-preferences';

export type ImportConflictPhase = 'name' | 'duplicate';

export type ImportConflictPresentation = {
  readonly nameDecision: RememberedNameConflictDecision;
  readonly duplicateDecision: RememberedDuplicateDecision;
  /** null = auto-resolve without showing a dialog */
  readonly phase: ImportConflictPhase | null;
};

export function resolveImportConflictPresentation(
  plan: ImportConflictPlan,
  prefs: ImportConflictPreferences,
  defaults: {
    nameDecision: RememberedNameConflictDecision;
    duplicateDecision: RememberedDuplicateDecision;
  } = {
    nameDecision: 'keep-both',
    duplicateDecision: 'skip',
  },
): ImportConflictPresentation {
  const needsName = plan.nameConflictCount > 0;
  const needsDuplicate = plan.suspectedDuplicateCount > 0;
  const nameDecision = prefs.nameConflict ?? defaults.nameDecision;
  const duplicateDecision = prefs.duplicate ?? defaults.duplicateDecision;
  const nameRemembered = prefs.nameConflict !== null;
  const duplicateRemembered = prefs.duplicate !== null;

  if (needsName && !nameRemembered) {
    return { nameDecision, duplicateDecision, phase: 'name' };
  }
  if (needsDuplicate && !duplicateRemembered) {
    return { nameDecision, duplicateDecision, phase: 'duplicate' };
  }
  return { nameDecision, duplicateDecision, phase: null };
}

export function nextImportConflictPhaseAfterName(
  plan: ImportConflictPlan,
  prefs: ImportConflictPreferences,
): ImportConflictPhase | null {
  if (plan.suspectedDuplicateCount > 0 && prefs.duplicate === null) {
    return 'duplicate';
  }
  return null;
}
