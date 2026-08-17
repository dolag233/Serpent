import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  automationRecentScriptEntrySchema,
  type AutomationRecentScriptEntry,
} from '../shared/automation-script-api';

export const AUTOMATION_RECENT_SCRIPTS_LIMIT = 12;

const identifier = z.string().uuid();

const storedRecentScriptSchema = z.strictObject({
  handle: identifier,
  displayName: z.string().min(1).max(255),
  absolutePath: z.string().min(1),
  lastOpenedAt: z.string().min(1),
});

const recentScriptsSnapshotSchema = z.strictObject({
  version: z.literal(1),
  entries: z.array(storedRecentScriptSchema).max(AUTOMATION_RECENT_SCRIPTS_LIMIT),
});

type StoredRecentScript = z.infer<typeof storedRecentScriptSchema>;
type RecentScriptsSnapshot = z.infer<typeof recentScriptsSnapshotSchema>;

export interface AutomationRecentScriptsStore {
  list(): AutomationRecentScriptEntry[];
  record(displayName: string, absolutePath: string): void;
  resolvePath(handle: string): string | undefined;
}

function defaultSnapshot(): RecentScriptsSnapshot {
  return { version: 1, entries: [] };
}

function normalizeAbsolutePath(absolutePath: string): string {
  return path.resolve(absolutePath);
}

function toPublicEntry(entry: StoredRecentScript): AutomationRecentScriptEntry {
  return automationRecentScriptEntrySchema.parse({
    handle: entry.handle,
    displayName: entry.displayName,
    lastOpenedAt: entry.lastOpenedAt,
  });
}

export function createJsonFileAutomationRecentScriptsStore(
  filename: string,
  options?: { clock?: () => Date; newHandle?: () => string },
): AutomationRecentScriptsStore {
  const clock = options?.clock ?? (() => new Date());
  const newHandle = options?.newHandle ?? randomUUID;
  let snapshot = loadSnapshot(filename);

  const persist = (): void => {
    const parsed = recentScriptsSnapshotSchema.parse(snapshot);
    mkdirSync(path.dirname(filename), { recursive: true });
    const temporaryFilename = `${filename}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporaryFilename, `${JSON.stringify(parsed)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryFilename, filename);
  };

  return {
    list(): AutomationRecentScriptEntry[] {
      return snapshot.entries.map(toPublicEntry);
    },
    record(displayName: string, absolutePath: string): void {
      const normalizedPath = normalizeAbsolutePath(absolutePath);
      const lastOpenedAt = clock().toISOString();
      const existingIndex = snapshot.entries.findIndex(
        (entry) => normalizeAbsolutePath(entry.absolutePath) === normalizedPath,
      );
      const nextEntry: StoredRecentScript = existingIndex === -1
        ? { handle: newHandle(), displayName, absolutePath: normalizedPath, lastOpenedAt }
        : {
          ...snapshot.entries[existingIndex]!,
          displayName,
          absolutePath: normalizedPath,
          lastOpenedAt,
        };
      const remaining = existingIndex === -1
        ? snapshot.entries
        : snapshot.entries.filter((_, index) => index !== existingIndex);
      snapshot = {
        version: 1,
        entries: [nextEntry, ...remaining].slice(0, AUTOMATION_RECENT_SCRIPTS_LIMIT),
      };
      persist();
    },
    resolvePath(handle: string): string | undefined {
      const parsedHandle = identifier.safeParse(handle);
      if (!parsedHandle.success) return undefined;
      return snapshot.entries.find((entry) => entry.handle === parsedHandle.data)?.absolutePath;
    },
  };
}

function loadSnapshot(filename: string): RecentScriptsSnapshot {
  if (!existsSync(filename)) return defaultSnapshot();
  return recentScriptsSnapshotSchema.parse(JSON.parse(readFileSync(filename, 'utf8')));
}
