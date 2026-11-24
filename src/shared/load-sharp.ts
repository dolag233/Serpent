import type sharp from 'sharp';

/**
 * Load Sharp for the Library Worker.
 *
 * Electron on glibc Linux already has the system GLib mapped. Sharp's
 * prebuilt libvips also contains its own GLib. OR-ing RTLD_DEEPBIND onto
 * sharp-*.node makes that second GLib call the process allocator and abort
 * at require time (`free(): invalid pointer`, `double free or corruption`).
 * The same abort happens in a real Electron utilityProcess, which is how
 * image import and thumbnail generation load Sharp. Default dlopen completes
 * encode and decode. GLib-GObject assertion warnings from the leaked system
 * GLib remain; they track https://github.com/electron/electron/issues/46323
 * and are not filtered here.
 */
export function loadSharp(): typeof sharp {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('sharp') as typeof sharp;
}
