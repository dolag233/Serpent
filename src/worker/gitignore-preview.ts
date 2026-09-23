import {
  GITIGNORE_PREVIEW_ROW_LIMIT,
  type GitignorePreview,
  type GitignorePreviewRow,
} from '../shared/asset-types';
import {
  sortGitignorePreviewRows,
  type GitignorePreviewCandidate,
} from '../shared/gitignore-preview';
import { gitignoreMatchesPath, type GitIgnoreMatcher } from './gitignore';

export function diffGitignoreHits(
  candidates: readonly GitignorePreviewCandidate[],
  saved: GitIgnoreMatcher,
  draft: GitIgnoreMatcher,
): GitignorePreview {
  const rows: GitignorePreviewRow[] = [];
  for (const candidate of candidates) {
    if (candidate.relativePath.length === 0) continue;
    const current = gitignoreMatchesPath(
      saved,
      candidate.relativePath,
      candidate.pathKind,
      candidate.locationKind,
    );
    const next = gitignoreMatchesPath(
      draft,
      candidate.relativePath,
      candidate.pathKind,
      candidate.locationKind,
    );
    if (!current && !next) continue;
    const change: GitignorePreviewRow['change'] = current && next
      ? 'kept'
      : next
        ? 'added'
        : 'removed';
    rows.push({ ...candidate, change });
  }

  const addedCount = rows.reduce((count, row) => count + (row.change === 'added' ? 1 : 0), 0);
  const removedCount = rows.reduce((count, row) => count + (row.change === 'removed' ? 1 : 0), 0);
  const keptCount = rows.length - addedCount - removedCount;
  const ordered = sortGitignorePreviewRows(rows);
  return {
    rows: ordered.slice(0, GITIGNORE_PREVIEW_ROW_LIMIT),
    currentCount: keptCount + removedCount,
    addedCount,
    removedCount,
    truncated: ordered.length > GITIGNORE_PREVIEW_ROW_LIMIT,
  };
}
