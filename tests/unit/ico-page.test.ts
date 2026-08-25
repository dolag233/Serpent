import { describe, expect, it } from "vitest";

import { parseIcoPageSizes, pickLargestIcoPage } from "../../src/worker/ico-page";

function icoDirectory(widths: number[]): Uint8Array {
  const data = new Uint8Array(6 + widths.length * 16);
  const view = new DataView(data.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, widths.length, true);
  widths.forEach((width, page) => {
    const offset = 6 + page * 16;
    data[offset] = width === 256 ? 0 : width;
    data[offset + 1] = width === 256 ? 0 : width;
  });
  return data;
}

describe("parseIcoPageSizes", () => {
  it("reads directory order and expands the 0 byte to 256px", () => {
    expect(parseIcoPageSizes(icoDirectory([16, 48, 256]))).toEqual([
      { page: 0, width: 16, height: 16 },
      { page: 1, width: 48, height: 48 },
      { page: 2, width: 256, height: 256 },
    ]);
  });

  it("rejects non-ICO headers and truncated directories", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(parseIcoPageSizes(png)).toEqual([]);
    expect(parseIcoPageSizes(new Uint8Array([0, 0, 1, 0, 1, 0]))).toEqual([]);
  });
});

describe("pickLargestIcoPage", () => {
  it("selects the largest rendered area instead of the first layer", () => {
    expect(
      pickLargestIcoPage([
        { page: 0, width: 16, height: 16 },
        { page: 1, width: 256, height: 256 },
        { page: 2, width: 48, height: 48 },
      ]),
    ).toBe(1);
  });

  it("keeps the first page when equal-sized candidates tie", () => {
    expect(
      pickLargestIcoPage([
        { page: 2, width: 64, height: 64 },
        { page: 1, width: 64, height: 64 },
      ]),
    ).toBe(1);
  });

  it("falls back to page zero when metadata is unusable", () => {
    expect(pickLargestIcoPage([{ page: -1, width: 512, height: 512 }])).toBe(0);
  });
});
