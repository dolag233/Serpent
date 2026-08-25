/**
 * ICO files can contain several size/depth variants. Browsers and some image
 * decoders choose the first entry, which is often the smallest 16px layer.
 * Keep the choice deterministic and prefer the largest rendered area.
 */
export interface IcoPageSize {
  page: number;
  width: number;
  height: number;
}

/**
 * Read the dimensions from an ICO directory without decoding any pixel data.
 *
 * OIIO preserves ICO directory order as its subimage order.  Reading the
 * small directory is more reliable than asking a general-purpose decoder for
 * page metadata (Sharp does not decode ICO on every platform), and it also
 * lets the thumbnail and viewer paths make the same choice.
 */
export function parseIcoPageSizes(data: Uint8Array): IcoPageSize[] {
  if (data.byteLength < 6) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) return [];
  const count = view.getUint16(4, true);
  const directoryEnd = 6 + count * 16;
  if (count === 0 || directoryEnd > data.byteLength) return [];

  const pages: IcoPageSize[] = [];
  for (let page = 0; page < count; page += 1) {
    const offset = 6 + page * 16;
    // ICO stores 0 for 256 pixels in the one-byte width/height fields.
    const width = data[offset] === 0 ? 256 : data[offset]!;
    const height = data[offset + 1] === 0 ? 256 : data[offset + 1]!;
    pages.push({ page, width, height });
  }
  return pages;
}

export function pickLargestIcoPage(pages: readonly IcoPageSize[]): number {
  let best: IcoPageSize | undefined;
  for (const candidate of pages) {
    if (
      !Number.isFinite(candidate.width) ||
      !Number.isFinite(candidate.height) ||
      candidate.width <= 0 ||
      candidate.height <= 0 ||
      !Number.isInteger(candidate.page) ||
      candidate.page < 0
    ) {
      continue;
    }
    if (
      best === undefined ||
      candidate.width * candidate.height > best.width * best.height ||
      (candidate.width * candidate.height === best.width * best.height &&
        candidate.page < best.page)
    ) {
      best = candidate;
    }
  }
  return best?.page ?? 0;
}
