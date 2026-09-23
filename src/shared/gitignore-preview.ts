import {
  GITIGNORE_PREVIEW_ROW_LIMIT,
  type GitignorePreviewRow,
} from './asset-types';
import type { PluginWidgetListCell } from './plugin-widget-ir';

export { GITIGNORE_PREVIEW_ROW_LIMIT };

const CHANGE_ORDER: Record<GitignorePreviewRow['change'], number> = {
  added: 0,
  removed: 1,
  kept: 2,
};

export type GitignorePreviewCandidate = Omit<GitignorePreviewRow, 'change'>;

export function gitignorePreviewCandidateKey(
  candidate: GitignorePreviewCandidate,
): string {
  return [
    candidate.locationKind,
    candidate.linkedFolderId ?? '',
    candidate.pathKind,
    candidate.relativePath,
  ].join('\0');
}

export function sortGitignorePreviewRows(
  rows: readonly GitignorePreviewRow[],
): GitignorePreviewRow[] {
  return [...rows].sort((left, right) => {
    const changeDelta = CHANGE_ORDER[left.change] - CHANGE_ORDER[right.change];
    if (changeDelta !== 0) return changeDelta;
    const nameDelta = left.displayName.localeCompare(right.displayName);
    if (nameDelta !== 0) return nameDelta;
    return gitignorePreviewCandidateKey(left).localeCompare(
      gitignorePreviewCandidateKey(right),
    );
  });
}

/**
 * Two-column cells matching the Host list used by Serpent-Plugin-Renamer:
 * currently ignored on the left (blue `match` when it will reappear),
 * after-save on the right (yellow `change` when it will newly hide).
 */
export function buildGitignorePreviewListRows(
  rows: readonly GitignorePreviewRow[],
): PluginWidgetListCell[][] {
  return rows.map((row) => {
    if (row.change === 'added') {
      return ['', { segments: [{ text: row.displayName, tone: 'change' }] }];
    }
    if (row.change === 'removed') {
      return [{ segments: [{ text: row.displayName, tone: 'match' }] }, ''];
    }
    return [row.displayName, row.displayName];
  });
}
