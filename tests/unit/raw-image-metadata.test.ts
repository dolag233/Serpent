import { describe, expect, it } from "vitest";

import {
  extractRawImageMetadata,
  normalizeRawImageMetadata,
} from "../../src/worker/raw-image-metadata";
import { buildRawImageMetadataRows } from "../../src/renderer/raw-image-metadata-format";
import { extractedVideoMetadataSchema } from "../../src/shared/asset-types";

describe("RAW image metadata", () => {
  it("normalizes camera EXIF fields without exposing arbitrary metadata", async () => {
    const parser = {
      parse: async () => ({
        Make: "Sony",
        Model: "ILCE-7RM3",
        Artist: "kanghong zhao",
        DateTimeOriginal: "2026:09:02 22:28:00",
        ExifImageWidth: 5184,
        ExifImageHeight: 3464,
        ISO: 800,
        FNumber: 3.5,
        ExposureTime: 0.01,
        ExposureCompensation: 0,
        ExposureProgram: 3,
        MeteringMode: 5,
        Flash: 0,
        FocalLength: 56,
        SecretPath: "E:\\private\\source.ARW",
      }),
    };

    const metadata = await extractRawImageMetadata("source.ARW", parser);

    expect(metadata).toMatchObject({
      width: 5184,
      height: 3464,
      cameraMake: "Sony",
      cameraModel: "ILCE-7RM3",
      author: "kanghong zhao",
      captureDate: new Date("2026-09-02T22:28:00").toISOString(),
      iso: 800,
      fNumber: 3.5,
      exposureTime: 0.01,
      exposureProgram: 3,
      meteringMode: 5,
      flash: 0,
      focalLength: 56,
    });
    expect(metadata).not.toHaveProperty("SecretPath");
  });

  it("renders base file details and camera fields in Chinese", () => {
    const metadata = extractedVideoMetadataSchema.parse(normalizeRawImageMetadata({
      Make: "Sony",
      Model: "ILCE-7RM3",
      ISO: 800,
      FNumber: 3.5,
      ExposureTime: 0.01,
      ExposureProgram: 3,
      MeteringMode: 5,
      Flash: 7,
      FocalLength: 56,
    }));
    const rows = buildRawImageMetadataRows(
      {
        displayName: "photo.ARW",
        relativeFilePath: "Photos/photo.ARW",
        locationKind: "managed",
        byteSize: 17.6 * 1024 ** 2,
        modifiedAt: "2026-09-02T14:28:00.000Z",
        width: 5184,
        height: 3464,
      },
      metadata,
      "kanghong zhao",
      "zh-CN",
    );

    expect(rows).toEqual(expect.arrayContaining([
      { field: "type", value: "ARW 文件" },
      { field: "size", value: "17.6 MB" },
      { field: "location", value: "Assets/Photos/photo.ARW" },
      { field: "resolution", value: "5184 × 3464" },
      { field: "author", value: "kanghong zhao" },
      { field: "cameraMake", value: "Sony" },
      { field: "cameraModel", value: "ILCE-7RM3" },
      { field: "iso", value: "ISO-800" },
      { field: "fNumber", value: "f/3.5" },
      { field: "exposureTime", value: "1/100 秒" },
      { field: "exposureProgram", value: "光圈优先" },
      { field: "meteringMode", value: "图案" },
      { field: "flash", value: "已闪光（检测到回光）" },
      { field: "focalLength", value: "56 毫米" },
    ]));
  });
});
