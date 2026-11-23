import { Buffer } from "node:buffer";

/** Bound temporary snapshot bytes without retaining chunks in the test host. */
export function createHeapSnapshotWriter(write: (chunk: string) => void, limitBytes = 256 * 1024 ** 2) {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 1) throw new Error("Snapshot byte limit must be positive.");
  let receivedBytes = 0;
  let writtenBytes = 0;
  let truncated = false;
  return {
    append(chunk: string) {
      const bytes = Buffer.byteLength(chunk, "utf8");
      receivedBytes += bytes;
      if (truncated || writtenBytes + bytes > limitBytes) {
        truncated = true;
        return;
      }
      write(chunk);
      writtenBytes += bytes;
    },
    read: () => ({ receivedBytes, writtenBytes, truncated }),
  };
}
