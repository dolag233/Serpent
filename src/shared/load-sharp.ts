import { constants } from 'node:os';
import type sharp from 'sharp';

/**
 * Electron on glibc Linux loads the system GLib before Sharp. Let Sharp's
 * addon and its prebuilt libvips resolve their own GLib symbols as a group.
 * Scope the loader override to Sharp's synchronous require and native addon.
 */
export function loadSharp(): typeof sharp {
  const deepBind = constants.dlopen.RTLD_DEEPBIND;
  const load = (): typeof sharp => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('sharp') as typeof sharp;
  };
  if (process.platform !== 'linux' || !process.versions.electron || deepBind === undefined) {
    return load();
  }

  const dlopen = process.dlopen;
  process.dlopen = function (module, filename, flags) {
    const isSharp = /(?:^|[/\\])sharp(?:-[\w.-]+)?\.node$/u.test(filename);
    return dlopen.call(this, module, filename, isSharp
      ? (flags ?? constants.dlopen.RTLD_LAZY) | deepBind
      : flags);
  };
  try {
    return load();
  } finally {
    process.dlopen = dlopen;
  }
}
