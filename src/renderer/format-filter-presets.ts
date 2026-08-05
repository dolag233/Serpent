// REQ-FILTER-025 follow-up (Serpent-1d4w): the format filter quick-chips are
// derived from the product format registries instead of a hardcoded list, so
// every supported format (images incl. RAW, video, audio, 3D models) is
// clickable without touching this module when the registry grows.
//
// The special `text` token (Serpent-4l7) is NOT an extension — the worker
// expands it to TEXT_EXTENSIONS when building the query — so it stays a
// standalone chip rendered after the registry groups.
import {
  IMAGE_EXTENSIONS,
  MODEL_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "../shared/media-formats";
import { AUDIO_EXTENSION_NAMES } from "../shared/audio-media";

export interface FormatFilterGroup {
  /** i18n key for the group label (filter.formatGroup*). */
  labelKey: string;
  /** Dotless extension tokens as they appear in the comma field. */
  extensions: readonly string[];
}

function dotless(extensions: readonly string[]): string[] {
  return extensions.map((extension) => extension.slice(1));
}

export const FORMAT_FILTER_GROUPS: readonly FormatFilterGroup[] = [
  {
    labelKey: "filter.formatGroupImage",
    extensions: dotless(IMAGE_EXTENSIONS),
  },
  {
    labelKey: "filter.formatGroupVideo",
    extensions: dotless(VIDEO_EXTENSIONS),
  },
  {
    labelKey: "filter.formatGroupAudio",
    extensions: AUDIO_EXTENSION_NAMES,
  },
  {
    labelKey: "filter.formatGroupModel",
    extensions: dotless(MODEL_EXTENSIONS),
  },
];

/** The non-extension token chip rendered after the registry groups. */
export const FORMAT_TEXT_TOKEN = "text" as const;
