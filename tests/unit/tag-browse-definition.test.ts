import { expect, it } from 'vitest';
import { tagBrowseDefinition } from '../../src/renderer/tag-browse-definition';

it('navigates to the whole exact tag rather than combining existing discovery filters', () => {
  const name = 'forest, hills | "reference"';
  const result = tagBrowseDefinition(name, {
    filters: [{ field: 'format', values: ['mp4'], exclude: false },
      { field: 'tag', values: ['unrelated'], exclude: true, includeAi: false }],
    sort: { field: 'modified_at', order: 'desc' },
  });
  expect(result).toEqual({
    filters: [{ field: 'tag', values: [name], exclude: false, includeAi: true }],
    sort: { field: 'modified_at', order: 'desc' },
  });
  expect('search' in result).toBe(false);
});
