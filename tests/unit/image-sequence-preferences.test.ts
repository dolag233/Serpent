import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_SEQUENCE_PREFERENCES,
  IMAGE_SEQUENCE_PREFERENCES_KEY,
  loadImageSequencePreferences,
  saveImageSequencePreferences,
} from "../../src/renderer/image-sequence-preferences";

function storage(initial?: string): Map<string, string> & {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
} {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(IMAGE_SEQUENCE_PREFERENCES_KEY, initial);
  return Object.assign(values, {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  });
}

describe("image sequence preferences", () => {
  it("defaults to detecting sequences", () => {
    expect(loadImageSequencePreferences(storage())).toEqual(
      DEFAULT_IMAGE_SEQUENCE_PREFERENCES,
    );
  });

  it("persists the import detection toggle", () => {
    const store = storage();
    saveImageSequencePreferences({ version: 1, autoDetectOnImport: false }, store);
    expect(loadImageSequencePreferences(store).autoDetectOnImport).toBe(false);
  });

  it("ignores malformed or unsupported values", () => {
    expect(loadImageSequencePreferences(storage("{}"))).toEqual(
      DEFAULT_IMAGE_SEQUENCE_PREFERENCES,
    );
    expect(loadImageSequencePreferences(storage("not-json"))).toEqual(
      DEFAULT_IMAGE_SEQUENCE_PREFERENCES,
    );
  });
});
