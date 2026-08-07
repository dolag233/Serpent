export type PbrTextureChannel =
  | "base-color"
  | "normal"
  | "roughness"
  | "smoothness"
  | "metallic"
  | "height"
  | "metallic-roughness";

export type PbrTextureDisplayMode =
  | "color"
  | "normal"
  | "scalar"
  | "inverted-scalar"
  | "packed";

export interface PbrTextureChannelPresentation {
  readonly channel: PbrTextureChannel;
  readonly displayMode: PbrTextureDisplayMode;
}

const CHANNEL_ALIASES: ReadonlyArray<
  readonly [PbrTextureChannel, readonly string[]]
> = [
  [
    "metallic-roughness",
    ["metallicroughness", "metalroughness", "metallic-roughness"],
  ],
  [
    "base-color",
    ["albedo", "basecolor", "base-color", "diffuse", "diffusemap"],
  ],
  ["normal", ["normal", "normalmap", "nrm", "nor", "bump"]],
  ["roughness", ["roughness", "rough", "rgh"]],
  ["smoothness", ["smoothness", "smooth", "glossiness", "gloss"]],
  ["metallic", ["metallic", "metalness", "metal"]],
  ["height", ["height", "displacement", "disp"]],
];

const DISPLAY_MODES: Readonly<
  Record<PbrTextureChannel, PbrTextureDisplayMode>
> = {
  "base-color": "color",
  normal: "normal",
  roughness: "scalar",
  smoothness: "inverted-scalar",
  metallic: "scalar",
  height: "scalar",
  "metallic-roughness": "packed",
};

/**
 * Infers a PBR channel from a filename without treating arbitrary image names
 * as channel maps. The classifier is intentionally filename-only: the worker
 * remains the source of file bytes, and a texture is never modified.
 */
export function detectPbrTextureChannel(
  fileName: string,
): PbrTextureChannelPresentation | null {
  const stem = fileName
    .replace(/\.[^.\\/]+$/u, "")
    .toLocaleLowerCase("en-US");
  const tokens = new Set(stem.split(/[^a-z0-9]+/u).filter(Boolean));
  const compact = stem.replace(/[^a-z0-9]+/gu, "");

  for (const [channel, aliases] of CHANNEL_ALIASES) {
    if (
      aliases.some(
        (alias) =>
          tokens.has(alias) ||
          (alias.includes("-") && tokens.has(alias.replace("-", ""))) ||
          compact.includes(alias.replace("-", "")),
      )
    ) {
      return {
        channel,
        displayMode: DISPLAY_MODES[channel],
      };
    }
  }
  return null;
}

export function pbrTextureDisplayFilter(
  presentation: PbrTextureChannelPresentation,
): string {
  switch (presentation.displayMode) {
    case "scalar":
      return "grayscale(1)";
    case "inverted-scalar":
      // Smoothness is the inverse of roughness. Keeping this in the viewer
      // makes the relationship visible without rewriting the source image.
      return "grayscale(1) invert(1)";
    case "color":
    case "normal":
    case "packed":
      return "none";
  }
}
