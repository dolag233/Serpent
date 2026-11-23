import { afterEach, expect, test, vi } from "vitest";

import {
  chooseLibraryCreateLocation,
  consumeLibraryCreateLocation,
  rememberLibraryCreateLocation,
} from "../../src/main/library-create-location";
import { executeLibraryMainCommand, type LibraryCommandRuntime } from "../../src/main/commands/library";
import { parseRendererRequest } from "../../src/shared/protocol/requests";
import { parseRendererResult } from "../../src/shared/protocol/responses";

afterEach(() => { rememberLibraryCreateLocation(undefined); });

test("the native create choice returns opaque one-use authority, never a renderer path", async () => {
  const token = await chooseLibraryCreateLocation(async () => "fixture-parent");
  expect(token).toEqual(expect.any(String));
  expect(token).not.toContain("fixture-parent");
  expect(parseRendererResult({
    ok: true, type: "library.create-location-chosen", selectionToken: token,
  })).toEqual({ ok: true, type: "library.create-location-chosen", selectionToken: token });
  const request = parseRendererRequest({
    type: "library.create.request", displayName: "Studio", selectionToken: token,
  });
  const selectDirectory = vi.fn();
  const runtime = { selectDirectory } as unknown as LibraryCommandRuntime;
  await expect(executeLibraryMainCommand(request, runtime)).resolves.toEqual({
    type: "library.create", displayName: "Studio", selectedParentPath: "fixture-parent",
  });
  await expect(executeLibraryMainCommand(request, runtime)).resolves.toBeUndefined();
  expect(selectDirectory).not.toHaveBeenCalled();
});

test("forged tokens cannot create a library or fall back to another picker", async () => {
  const selectDirectory = vi.fn();
  await expect(executeLibraryMainCommand({
    type: "library.create.request", displayName: "Studio", selectionToken: "forged-token",
  }, { selectDirectory } as unknown as LibraryCommandRuntime)).resolves.toBeUndefined();
  expect(selectDirectory).not.toHaveBeenCalled();
});

test("cancelling a new picker invalidates any earlier unconsumed choice", async () => {
  const first = await chooseLibraryCreateLocation(async () => "fixture-parent");
  expect(await chooseLibraryCreateLocation(async () => undefined)).toBeNull();
  expect(consumeLibraryCreateLocation(first!)).toBeUndefined();
  expect(parseRendererResult({
    ok: true, type: "library.create-location-chosen", selectionToken: null,
  })).toMatchObject({ selectionToken: null });
});

test("a new successful picker invalidates the previous token", async () => {
  const first = await chooseLibraryCreateLocation(async () => "first-parent");
  const second = await chooseLibraryCreateLocation(async () => "second-parent");
  expect(consumeLibraryCreateLocation(first!)).toBeUndefined();
  expect(consumeLibraryCreateLocation(second!)).toBe("second-parent");
});

test("concurrent picker requests do not open another dialog or replace the active choice", async () => {
  let finish!: (value: string) => void;
  const first = chooseLibraryCreateLocation(() => new Promise(resolve => { finish = resolve; }));
  const duplicatePicker = vi.fn(async () => "duplicate-parent");
  expect(await chooseLibraryCreateLocation(duplicatePicker)).toBeNull();
  expect(duplicatePicker).not.toHaveBeenCalled();
  finish("fixture-parent");
  expect(consumeLibraryCreateLocation((await first)!)).toBe("fixture-parent");
});

test("a failed native picker releases ownership for the next attempt", async () => {
  await expect(chooseLibraryCreateLocation(async () => { throw new Error("picker failed"); })).rejects.toThrow("picker failed");
  const token = await chooseLibraryCreateLocation(async () => "fixture-parent");
  expect(consumeLibraryCreateLocation(token!)).toBe("fixture-parent");
});

test("the create bridge rejects arbitrary paths and malformed selection authority", () => {
  expect(parseRendererRequest({ type: "library.choose-create-location.request" })).toEqual({
    type: "library.choose-create-location.request",
  });
  for (const fields of [{ selectedParentPath: "forged-parent" }, { selectionToken: "" }]) {
    expect(() => parseRendererRequest({
      type: "library.create.request", displayName: "Studio", ...fields,
    })).toThrow();
  }
});
