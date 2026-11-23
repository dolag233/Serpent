import { expect, test } from "vitest";
import { createHeapSnapshotWriter } from "../e2e/heap-snapshot-writer";

test("bounds UTF-8 disk bytes and discards subsequent chunks after overflow", () => {
  const chunks: string[] = [];
  const writer = createHeapSnapshotWriter(chunk => chunks.push(chunk), 8);
  writer.append("星");
  writer.append("abc");
  writer.append("星");
  writer.append("z");
  expect(chunks).toEqual(["星", "abc"]);
  expect(writer.read()).toEqual({ receivedBytes: 10, writtenBytes: 6, truncated: true });
});

test("accepts exactly the byte limit without retaining a copy of the content", () => {
  let bytes = 0;
  const writer = createHeapSnapshotWriter(chunk => { bytes += chunk.length; }, 4);
  writer.append("ab");
  writer.append("cd");
  expect(bytes).toBe(4);
  expect(writer.read()).toEqual({ receivedBytes: 4, writtenBytes: 4, truncated: false });
});

test("rejects invalid budgets before writing", () => {
  for (const limit of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
    expect(() => createHeapSnapshotWriter(() => undefined, limit)).toThrow("Snapshot byte limit");
  }
});
