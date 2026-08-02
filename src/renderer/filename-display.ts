export type FilenameDisplayParts = {
  prefix: string;
  tail: string;
  extension: string;
};

/**
 * Keep the extension and the final three stem characters visible while the
 * flexible prefix takes any available width and receives CSS ellipsis.
 */
export function splitFilenameForDisplay(name: string): FilenameDisplayParts {
  const extensionStart = name.lastIndexOf(".");
  const hasExtension = extensionStart > 0 && extensionStart < name.length - 1;
  const extension = hasExtension ? name.slice(extensionStart) : "";
  const stem = hasExtension ? name.slice(0, extensionStart) : name;
  if (stem.length <= 3) return { prefix: stem, tail: "", extension };
  return { prefix: stem.slice(0, -3), tail: stem.slice(-3), extension };
}
