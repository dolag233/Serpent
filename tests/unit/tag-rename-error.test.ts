import { expect, it } from 'vitest';
import { LibraryOperationError } from '../../src/renderer/error-utils';
import { tagRenameError } from '../../src/renderer/tag-rename-error';

it('describes a duplicate tag as a tag rather than a file or folder conflict', () => {
  const error = new LibraryOperationError({ code: 'FOLDER_ALREADY_EXISTS', message: 'duplicate' });
  expect(tagRenameError(error, 'zh-CN')).toBe('已存在同名标签，请换一个名称。');
  expect(tagRenameError(error, 'en')).toContain('tag');
  expect(tagRenameError(error, 'en')).not.toMatch(/file|folder/);
});
