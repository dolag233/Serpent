import { describe, expect, it } from 'vitest';

import {
  buildLibraryTransferMenuItems,
  LIBRARY_TRANSFER_MENU_ORDER,
} from '../../src/renderer/library-transfer-menu';

describe('library transfer menu (Serpent-qm6w)', () => {
  it('orders imports before export and library import before library export', () => {
    const items = buildLibraryTransferMenuItems({
      handlers: {
        'import-folder': () => {},
        'import-linked-folder': () => {},
        'import-library': () => {},
        'export-library': () => {},
      },
      libraryScopedDisabled: false,
      busy: false,
      importFolderCopy: {
        labelKey: 'toolbar.importFolder',
        titleKey: 'toolbar.importFolder',
      },
      importLinkedFolderCopy: {
        labelKey: 'toolbar.importLinkedFolder',
        titleKey: 'toolbar.importLinkedFolder',
      },
    });

    expect(items.map((item) => item.id)).toEqual([
      ...LIBRARY_TRANSFER_MENU_ORDER,
    ]);
  });

  it('omits handlers that are not wired', () => {
    const items = buildLibraryTransferMenuItems({
      handlers: {
        'import-library': () => {},
        'export-library': () => {},
      },
      libraryScopedDisabled: false,
      busy: false,
      importFolderCopy: {
        labelKey: 'toolbar.importFolder',
        titleKey: 'toolbar.importFolder',
      },
      importLinkedFolderCopy: {
        labelKey: 'toolbar.importLinkedFolder',
        titleKey: 'toolbar.importLinkedFolder',
      },
    });

    expect(items.map((item) => item.id)).toEqual([
      'import-library',
      'export-library',
    ]);
  });
});
