import { z } from "zod";

export const APP_LOG_LEVELS = ["info", "error"] as const;
export type AppLogLevel = (typeof APP_LOG_LEVELS)[number];

export type SerializedLogError = {
  name?: string;
  message?: string;
  code?: string;
  stack?: string;
  cause?: SerializedLogError | { value: string } | { truncated: true };
};

export type AppLogEntry = {
  timestamp: string;
  level: AppLogLevel;
  scope: string;
  message?: string;
  context?: Record<string, unknown>;
  error?: SerializedLogError | { value: string } | { truncated: true };
};

const serializedLogErrorSchema: z.ZodType<SerializedLogError> = z.lazy(() =>
  z.object({
    name: z.string().optional(),
    message: z.string().optional(),
    code: z.string().optional(),
    stack: z.string().optional(),
    cause: z.union([
      serializedLogErrorSchema,
      z.object({ value: z.string() }),
      z.object({ truncated: z.literal(true) }),
    ]).optional(),
  }),
);

export const appLogEntrySchema = z.object({
  timestamp: z.string().min(1),
  level: z.enum(APP_LOG_LEVELS),
  scope: z.string().min(1),
  message: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  error: z.union([
    serializedLogErrorSchema,
    z.object({ value: z.string() }),
    z.object({ truncated: z.literal(true) }),
  ]).optional(),
});

export function parseAppLogEntry(input: unknown): AppLogEntry | null {
  const parsed = appLogEntrySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export type ReadAppLogResult =
  | { ok: true; entries: AppLogEntry[]; fileName: "serpent.log" }
  | { ok: false; code: "unauthorized_sender" | "log_missing" | "read_failure" };
