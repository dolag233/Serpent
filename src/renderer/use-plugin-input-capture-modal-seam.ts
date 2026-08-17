import { useEffect } from 'react';

import type { SerpentShellApi } from '../shared/external-url';
import type { DialogEscapeSnapshot } from './dialog-escape-stack';
import {
  isPluginInputCaptureSystemModalDomOpen,
  resolvePluginInputCaptureSystemModalActive,
} from './plugin-input-capture-modal-seam';

/** Notify Main broker to pause capture while Host modals are open. */
export function usePluginInputCaptureModalSeam(input: {
  readonly shell: SerpentShellApi | undefined;
  readonly snapshot: DialogEscapeSnapshot;
}): void {
  useEffect(() => {
    const shell = input.shell;
    if (shell?.setInputCaptureSystemModalActive === undefined) return;

    const sync = () => {
      const active = resolvePluginInputCaptureSystemModalActive(input.snapshot, {
        domModalOpen: isPluginInputCaptureSystemModalDomOpen(),
      });
      shell.setInputCaptureSystemModalActive(active);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-modal'] });
    return () => {
      observer.disconnect();
      shell.setInputCaptureSystemModalActive(false);
    };
  }, [input.shell, input.snapshot]);
}
