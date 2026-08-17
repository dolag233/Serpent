import { readAtomicJsonFile, writeAtomicJsonFile } from './atomic-json-file';
import { z } from 'zod';

const idempotencyKeySchema = z.string().min(1).max(512);
const idempotencyRecordSchema = z.strictObject({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  result: z.unknown(),
  completedAt: z.string().datetime(),
});
const snapshotSchema = z.strictObject({
  version: z.literal(1),
  records: z.record(idempotencyKeySchema, idempotencyRecordSchema),
});

export type AutomationIdempotencyRecord = z.infer<typeof idempotencyRecordSchema>;

export interface AutomationIdempotencyStore {
  get(key: string): AutomationIdempotencyRecord | undefined;
  put(key: string, record: AutomationIdempotencyRecord): void;
  delete(key: string): void;
}

/**
 * Main-owned durable results for stateless automation calls.  This store is
 * intentionally separate from the transport session and from the library DB:
 * reconnecting an MCP client must not repeat a committed mutation merely
 * because the Worker/library is currently closed.
 */
export function createJsonFileAutomationIdempotencyStore(
  filename: string,
  options: { maxRecords?: number } = {},
): AutomationIdempotencyStore {
  const maxRecords = Math.max(128, Math.min(16_384, Math.floor(options.maxRecords ?? 4_096)));
  const records = new Map<string, AutomationIdempotencyRecord>();

  const load = (): void => {
    const contents = readAtomicJsonFile(filename);
    if (contents === undefined) return;
    let raw: unknown;
    try {
      raw = JSON.parse(contents);
    } catch {
      return;
    }
    const parsed = snapshotSchema.safeParse(raw);
    if (!parsed.success) return;
    for (const [key, record] of Object.entries(parsed.data.records)) records.set(key, record);
    while (records.size > maxRecords) records.delete(records.keys().next().value!);
  };
  const persist = (): void => {
    const snapshot = snapshotSchema.parse({
      version: 1,
      records: Object.fromEntries(records),
    });
    writeAtomicJsonFile(filename, `${JSON.stringify(snapshot)}\n`);
  };

  load();
  return {
    get(key) {
      return records.get(key);
    },
    put(key, record) {
      const parsedKey = idempotencyKeySchema.parse(key);
      records.delete(parsedKey);
      records.set(parsedKey, idempotencyRecordSchema.parse(record));
      while (records.size > maxRecords) records.delete(records.keys().next().value!);
      persist();
    },
    delete(key) {
      if (records.delete(idempotencyKeySchema.parse(key))) persist();
    },
  };
}
