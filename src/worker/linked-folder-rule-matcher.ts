import path from 'node:path';

import type { LinkedFolderRule } from '../shared/asset-types';

const fold = (value: string): string => value.normalize('NFC').toLocaleLowerCase('en-US');

/** Rules have already passed LibraryService's shared validation. */
export function compileLinkedFolderRules(rules: readonly LinkedFolderRule[]): (normalizedPath: string) => boolean {
  const compiled = rules.filter((rule) => rule.enabled).map((rule) => ({ ...rule, pattern: fold(rule.pattern) }));
  return (normalizedPath) => {
    const value = fold(normalizedPath);
    const segments = value.split('/');
    const filename = segments.at(-1)!;
    const folders = segments.slice(0, -1);
    const extension = path.posix.extname(filename).replace(/^\./u, '');
    let ignored = false;
    for (const rule of compiled) {
      const matches = rule.target === 'path'
        ? value === rule.pattern || value.startsWith(`${rule.pattern}/`)
        : rule.target === 'filename'
          ? filename === rule.pattern
          : rule.target === 'extension'
            ? extension === rule.pattern
            : folders.includes(rule.pattern);
      if (matches) ignored = rule.action === 'exclude';
    }
    return ignored;
  };
}
