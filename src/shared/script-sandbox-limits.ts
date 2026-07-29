/**
 * A deliberately small ceiling for code accepted by the developer preview.
 *
 * This is enforced before TypeScript parses the source, so a pasted payload
 * cannot use transpilation itself to consume an unbounded amount of memory.
 * The formal Script Runtime may define a different, versioned budget later.
 */
export const SCRIPT_SANDBOX_PREVIEW_MAX_SOURCE_BYTES = 64 * 1024;

const utf8Encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}
