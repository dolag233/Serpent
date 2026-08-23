import type { AssetSummary, ExtractedVideoMetadata } from "../shared/asset-types";

export type RawMetadataField =
  | "type"
  | "size"
  | "location"
  | "modifiedAt"
  | "captureDate"
  | "resolution"
  | "author"
  | "cameraMake"
  | "cameraModel"
  | "lensModel"
  | "iso"
  | "fNumber"
  | "exposureTime"
  | "exposureCompensation"
  | "exposureProgram"
  | "meteringMode"
  | "flash"
  | "focalLength";

export interface RawMetadataRow {
  field: RawMetadataField;
  value: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
}

function scalarNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scalarText(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function formatDateTime(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function localizedEnum(
  value: number | string | null | undefined,
  locale: string,
  numeric: Record<number, [string, string]>,
  aliases: Record<string, [string, string]>,
): string | null {
  if (value === null || value === undefined) return null;
  const numericValue = scalarNumber(value);
  const languageIndex = locale === "zh-CN" ? 0 : 1;
  if (numericValue !== null && numeric[numericValue]) {
    return numeric[numericValue]![languageIndex];
  }
  const text = scalarText(value);
  if (!text) return null;
  const alias = aliases[text.toLocaleLowerCase()];
  return alias ? alias[languageIndex] : text;
}

function formatExposureTime(
  value: number | string | null | undefined,
  locale: string,
): string | null {
  const numericValue = scalarNumber(value);
  const suffix = locale === "zh-CN" ? " 秒" : " s";
  if (numericValue === null) {
    const text = scalarText(value);
    return text ? `${text}${suffix}` : null;
  }
  if (numericValue > 0 && numericValue < 1) {
    return `1/${Math.max(1, Math.round(1 / numericValue))}${suffix}`;
  }
  return `${formatNumber(numericValue)}${suffix}`;
}

function addRow(
  rows: RawMetadataRow[],
  field: RawMetadataField,
  value: string | null | undefined,
): void {
  if (value) rows.push({ field, value });
}

export function buildRawImageMetadataRows(
  asset: Pick<
    AssetSummary,
    "displayName" | "relativeFilePath" | "locationKind" | "byteSize" | "modifiedAt" | "width" | "height"
  >,
  metadata: ExtractedVideoMetadata | null | undefined,
  author: string | null | undefined,
  locale: string,
): RawMetadataRow[] {
  const rows: RawMetadataRow[] = [];
  const extension = /\.([^.]+)$/u.exec(asset.displayName)?.[1]?.toUpperCase() ?? "RAW";
  const location = asset.locationKind === "managed"
    ? `Assets/${asset.relativeFilePath}`
    : asset.relativeFilePath;
  const width = asset.width ?? metadata?.width;
  const height = asset.height ?? metadata?.height;

  addRow(rows, "type", `${extension} ${locale === "zh-CN" ? "文件" : "file"}`);
  addRow(rows, "size", formatBytes(asset.byteSize));
  addRow(rows, "location", location);
  addRow(rows, "modifiedAt", formatDateTime(asset.modifiedAt, locale));
  addRow(
    rows,
    "captureDate",
    formatDateTime(metadata?.captureDate, locale),
  );
  addRow(
    rows,
    "resolution",
    width && height ? `${width} × ${height}` : null,
  );
  addRow(rows, "author", author);
  addRow(rows, "cameraMake", scalarText(metadata?.cameraMake));
  addRow(rows, "cameraModel", scalarText(metadata?.cameraModel));
  addRow(rows, "lensModel", scalarText(metadata?.lensModel));
  addRow(
    rows,
    "iso",
    scalarText(metadata?.iso)
      ? `ISO-${scalarText(metadata?.iso)}`
      : null,
  );
  const fNumber = scalarNumber(metadata?.fNumber);
  addRow(rows, "fNumber", fNumber === null ? scalarText(metadata?.fNumber) : `f/${formatNumber(fNumber)}`);
  addRow(rows, "exposureTime", formatExposureTime(metadata?.exposureTime, locale));
  const exposureCompensation = scalarNumber(metadata?.exposureCompensation);
  addRow(
    rows,
    "exposureCompensation",
    exposureCompensation === null
      ? scalarText(metadata?.exposureCompensation)
      : `${exposureCompensation > 0 ? "+" : ""}${formatNumber(exposureCompensation)} EV`,
  );
  addRow(
    rows,
    "exposureProgram",
    localizedEnum(
      metadata?.exposureProgram,
      locale,
      {
        0: ["未定义", "Not defined"],
        1: ["手动", "Manual"],
        2: ["程序自动", "Program auto"],
        3: ["光圈优先", "Aperture priority"],
        4: ["快门优先", "Shutter priority"],
        5: ["创意", "Creative"],
        6: ["动作", "Action"],
        7: ["人像", "Portrait"],
        8: ["风景", "Landscape"],
      },
      {
        manual: ["手动", "Manual"],
        "program ae": ["程序自动", "Program auto"],
        "aperture priority": ["光圈优先", "Aperture priority"],
        "shutter priority": ["快门优先", "Shutter priority"],
      },
    ),
  );
  addRow(
    rows,
    "meteringMode",
    localizedEnum(
      metadata?.meteringMode,
      locale,
      {
        0: ["未知", "Unknown"],
        1: ["平均", "Average"],
        2: ["中央重点", "Center-weighted"],
        3: ["点测光", "Spot"],
        4: ["多点测光", "Multi-spot"],
        5: ["图案", "Pattern"],
        6: ["局部", "Partial"],
        255: ["其他", "Other"],
      },
      {
        pattern: ["图案", "Pattern"],
        spot: ["点测光", "Spot"],
        "center-weighted average": ["中央重点", "Center-weighted"],
      },
    ),
  );
  addRow(
    rows,
    "flash",
    localizedEnum(
      metadata?.flash,
      locale,
      {
        0: ["未闪光", "Did not fire"],
        1: ["已闪光", "Fired"],
        5: ["已闪光（未检测到回光）", "Fired, return not detected"],
        7: ["已闪光（检测到回光）", "Fired, return detected"],
        8: ["未闪光（强制闪光模式）", "Did not fire, compulsory flash mode"],
        9: ["已闪光（强制闪光模式）", "Fired, compulsory flash mode"],
        13: ["已闪光（强制闪光，未检测到回光）", "Fired, compulsory, return not detected"],
        15: ["已闪光（强制闪光，检测到回光）", "Fired, compulsory, return detected"],
        16: ["未闪光（强制关闭）", "Did not fire, compulsory suppression"],
        24: ["未闪光（自动模式）", "Did not fire, auto mode"],
        25: ["已闪光（自动模式）", "Fired, auto mode"],
        29: ["已闪光（自动模式，未检测到回光）", "Fired, auto, return not detected"],
        31: ["已闪光（自动模式，检测到回光）", "Fired, auto, return detected"],
        32: ["无闪光灯功能", "No flash function"],
      },
      {
        "flash did not fire": ["未闪光", "Did not fire"],
        "flash fired": ["已闪光", "Fired"],
      },
    ) ?? (() => {
      const value = scalarNumber(metadata?.flash);
      return value === null
        ? null
        : `${locale === "zh-CN" ? "闪光灯代码 " : "Flash code "}${formatNumber(value)}`;
    })(),
  );
  const focalLength = scalarNumber(metadata?.focalLength);
  addRow(
    rows,
    "focalLength",
    focalLength === null
      ? scalarText(metadata?.focalLength)
      : `${formatNumber(focalLength)}${locale === "zh-CN" ? " 毫米" : " mm"}`,
  );
  return rows;
}
