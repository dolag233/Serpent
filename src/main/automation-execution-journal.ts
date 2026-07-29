import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  AUTOMATION_API_VERSION,
  automationCapabilitySchema,
  automationSourceSchema,
  getAutomationCommandDescriptor,
  type AutomationCapability,
  type AutomationSource,
} from '../automation/command-registry';
import { PUBLIC_ERROR_MESSAGES, type PublicErrorCode } from '../shared/protocol/errors';
import type {
  AutomationExecutionContext,
  AutomationExecutionResolver,
} from '../automation/command-gateway';

const automationExecutionStatusSchema = z.enum([
  'created',
  'validating',
  'awaiting-authorization',
  'running',
  'awaiting-approval',
  'succeeded',
  'partially-succeeded',
  'failed',
  'cancelled',
  'timed-out',
]);

export type AutomationExecutionStatus = z.infer<typeof automationExecutionStatusSchema>;

const nonBlankString = z.string().min(1).max(255).refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank.',
});

/**
 * Library IDs are UUIDs generated inside the Library Worker. Journal records
 * must never accept a path-shaped value in their place: records and AppLogger
 * context are intentionally free of unredacted filesystem locations.
 */
const automationLibraryIdSchema = z.string().uuid();
const automationSessionIdSchema = z.string().uuid();

const automationExecutionFailureCodes = [
  'AUTOMATION_INVALID_REQUEST',
  'AUTOMATION_API_VERSION_UNSUPPORTED',
  'AUTOMATION_COMMAND_NOT_FOUND',
  'AUTOMATION_EXECUTION_NOT_FOUND',
  'AUTOMATION_SOURCE_NOT_ALLOWED',
  'AUTOMATION_CAPABILITY_DENIED',
  'AUTOMATION_CONCURRENCY_LIMIT_REACHED',
  'AUTOMATION_RESULT_INVALID',
  'AUTOMATION_GRANT_NOT_ALLOWED',
  'AUTOMATION_CANCELLED',
  'AUTOMATION_INTERRUPTED_BY_RESTART',
  'AUTOMATION_SESSION_ENDED',
  'AUTOMATION_TIMED_OUT',
  'AUTOMATION_COMMAND_FAILED',
  'AUTOMATION_EXECUTION_LIMIT_REACHED',
] as const;

const publicErrorCodes = Object.keys(PUBLIC_ERROR_MESSAGES) as [PublicErrorCode, ...PublicErrorCode[]];
const automationExecutionFailureCodeSchema = z.union([
  z.enum(automationExecutionFailureCodes),
  z.enum(publicErrorCodes),
]);

export type AutomationExecutionFailureCode = z.infer<typeof automationExecutionFailureCodeSchema>;

export const automationExecutionResourceBudgetSchema = z.strictObject({
  maxWallTimeMs: z.number().int().min(1).max(30 * 60_000),
  maxCpuTimeMs: z.number().int().min(1).max(30 * 60_000),
  maxMemoryBytes: z.number().int().min(1).max(512 * 1024 * 1024),
  maxOutputBytes: z.number().int().min(1).max(16 * 1024 * 1024),
  maxConcurrentCommands: z.number().int().min(1).max(64),
  maxPendingPromises: z.number().int().min(1).max(4_096),
});

export type AutomationExecutionResourceBudget = z.infer<typeof automationExecutionResourceBudgetSchema>;

/**
 * A persisted reservation for the isolated Runtime. y51c.6 records the exact
 * budget; y51c.4 is responsible for enforcing it inside the terminable Guest.
 * This command concurrency limit is unrelated to the AI job concurrency
 * preference, which remains globally enforced by the job scheduler.
 */
export const DEFAULT_AUTOMATION_EXECUTION_RESOURCE_BUDGET: Readonly<AutomationExecutionResourceBudget> = {
  maxWallTimeMs: 60_000,
  maxCpuTimeMs: 10_000,
  maxMemoryBytes: 64 * 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxConcurrentCommands: 4,
  maxPendingPromises: 128,
};

const executionSummarySchema = z.strictObject({
  created: z.number().int().nonnegative().optional(),
  updated: z.number().int().nonnegative().optional(),
  succeeded: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
  skipped: z.number().int().nonnegative().optional(),
  jobs: z.number().int().nonnegative().optional(),
});

export type AutomationExecutionSummary = z.infer<typeof executionSummarySchema>;

const automationExecutionRecordSchema = z.strictObject({
  executionId: nonBlankString,
  logId: nonBlankString,
  source: automationSourceSchema,
  libraryId: automationLibraryIdSchema,
  apiVersion: z.literal(AUTOMATION_API_VERSION),
  scriptHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  sessionId: automationSessionIdSchema.nullable(),
  deadlineAt: z.string().datetime(),
  resourceBudget: automationExecutionResourceBudgetSchema,
  declaredCapabilities: z.array(automationCapabilitySchema).max(64),
  grantedCapabilities: z.array(automationCapabilitySchema).max(64),
  status: automationExecutionStatusSchema,
  commandCount: z.number().int().nonnegative(),
  succeededCommandCount: z.number().int().nonnegative(),
  failedCommandCount: z.number().int().nonnegative(),
  lastCommandId: nonBlankString.nullable(),
  failureCode: automationExecutionFailureCodeSchema.nullable(),
  summary: executionSummarySchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});

export type AutomationExecutionRecord = z.infer<typeof automationExecutionRecordSchema>;

const automationPersistentGrantSchema = z.strictObject({
  scriptHash: z.string().regex(/^[a-f0-9]{64}$/u),
  libraryId: automationLibraryIdSchema,
  capabilities: z.array(automationCapabilitySchema).max(64),
  grantedAt: z.string().datetime(),
});

export type AutomationPersistentGrant = z.infer<typeof automationPersistentGrantSchema>;

const automationExecutionJournalSnapshotSchema = z.strictObject({
  version: z.literal(1),
  executions: z.array(automationExecutionRecordSchema).max(2_000),
  persistentGrants: z.array(automationPersistentGrantSchema).max(2_000),
});

type AutomationExecutionJournalSnapshot = z.infer<typeof automationExecutionJournalSnapshotSchema>;

const terminalStatuses = new Set<AutomationExecutionStatus>([
  'succeeded',
  'partially-succeeded',
  'failed',
  'cancelled',
  'timed-out',
]);

function defaultSnapshot(): AutomationExecutionJournalSnapshot {
  return { version: 1, executions: [], persistentGrants: [] };
}

function normalizeCapabilities(capabilities: readonly AutomationCapability[]): AutomationCapability[] {
  return [...new Set(capabilities)].sort();
}

function capabilitySetsEqual(
  left: readonly AutomationCapability[],
  right: readonly AutomationCapability[],
): boolean {
  const normalizedLeft = normalizeCapabilities(left);
  const normalizedRight = normalizeCapabilities(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((capability, index) => capability === normalizedRight[index]);
}

function hashScript(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

function terminalStatus(status: AutomationExecutionStatus): boolean {
  return terminalStatuses.has(status);
}

function safeRecord(record: AutomationExecutionRecord): AutomationExecutionRecord {
  return {
    ...record,
    declaredCapabilities: [...record.declaredCapabilities],
    grantedCapabilities: [...record.grantedCapabilities],
    resourceBudget: { ...record.resourceBudget },
    summary: record.summary === null ? null : { ...record.summary },
  };
}

export interface AutomationExecutionStore {
  load(): AutomationExecutionJournalSnapshot;
  save(snapshot: AutomationExecutionJournalSnapshot): void;
}

/**
 * Local Main-owned storage for execution history and saved-script grants.
 * Script source is deliberately never accepted by this store: the journal only
 * receives its SHA-256 digest from AutomationExecutionJournal.
 */
export function createJsonFileAutomationExecutionStore(filename: string): AutomationExecutionStore {
  return {
    load(): AutomationExecutionJournalSnapshot {
      if (!existsSync(filename)) return defaultSnapshot();
      return automationExecutionJournalSnapshotSchema.parse(JSON.parse(readFileSync(filename, 'utf8')));
    },
    save(snapshot: AutomationExecutionJournalSnapshot): void {
      const parsed = automationExecutionJournalSnapshotSchema.parse(snapshot);
      mkdirSync(path.dirname(filename), { recursive: true });
      const temporaryFilename = `${filename}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(temporaryFilename, `${JSON.stringify(parsed)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(temporaryFilename, filename);
    },
  };
}

export interface AutomationExecutionAuditLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export type AutomationAuthorizationPersistence = 'session' | 'saved-script';

export interface CreateAutomationExecutionInput {
  source: AutomationSource;
  libraryId: string;
  scriptSource?: string;
  sessionId?: string;
  declaredCapabilities: readonly AutomationCapability[];
}

export interface AuthorizeAutomationExecutionInput {
  executionId: string;
  persistence: AutomationAuthorizationPersistence;
}

export type AuthorizeAutomationExecutionResult =
  | { ok: true; execution: AutomationExecutionRecord }
  | { ok: false; code: 'AUTOMATION_EXECUTION_NOT_FOUND' | 'AUTOMATION_GRANT_NOT_ALLOWED' };

export interface CompleteAutomationExecutionInput {
  status: Extract<AutomationExecutionStatus, 'succeeded' | 'partially-succeeded' | 'failed' | 'cancelled' | 'timed-out'>;
  summary?: AutomationExecutionSummary;
  failureCode?: AutomationExecutionFailureCode;
}

export interface AutomationExecutionJournalOptions {
  store: AutomationExecutionStore;
  /** Main must pass AppLogger; tests may pass a recording implementation. */
  logger: AutomationExecutionAuditLogger;
  clock?: () => Date;
  newId?: (prefix: 'execution' | 'log') => string;
  historyLimit?: number;
  persistentGrantLimit?: number;
  maxActiveExecutions?: number;
  resourceBudget?: AutomationExecutionResourceBudget;
}

export type AutomationExecutionJournalErrorCode = 'AUTOMATION_EXECUTION_LIMIT_REACHED';

export class AutomationExecutionJournalError extends Error {
  public readonly code: AutomationExecutionJournalErrorCode;

  public constructor(code: AutomationExecutionJournalErrorCode) {
    super(code === 'AUTOMATION_EXECUTION_LIMIT_REACHED'
      ? 'The maximum number of active automation executions has been reached.'
      : 'Automation execution journal error.');
    this.name = 'AutomationExecutionJournalError';
    this.code = code;
  }
}

/**
 * Main-owned authority for the lifecycle of one automation execution. It is
 * intentionally also the Gateway resolver: callers only know an execution ID;
 * library, source and capabilities are never supplied in command payloads.
 */
export class AutomationExecutionJournal implements AutomationExecutionResolver {
  readonly #store: AutomationExecutionStore;
  readonly #logger: AutomationExecutionAuditLogger;
  readonly #clock: () => Date;
  readonly #newId: (prefix: 'execution' | 'log') => string;
  readonly #historyLimit: number;
  readonly #persistentGrantLimit: number;
  readonly #maxActiveExecutions: number;
  readonly #resourceBudget: AutomationExecutionResourceBudget;
  readonly #abortControllers = new Map<string, AbortController>();
  readonly #deadlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #snapshot: AutomationExecutionJournalSnapshot;

  constructor({
    store,
    logger,
    clock = () => new Date(),
    newId = (prefix) => `${prefix}-${randomUUID()}`,
    historyLimit = 500,
    persistentGrantLimit = 500,
    maxActiveExecutions = 32,
    resourceBudget = DEFAULT_AUTOMATION_EXECUTION_RESOURCE_BUDGET,
  }: AutomationExecutionJournalOptions) {
    this.#store = store;
    this.#logger = logger;
    this.#clock = clock;
    this.#newId = newId;
    this.#maxActiveExecutions = Math.max(1, Math.min(256, Math.floor(maxActiveExecutions)));
    this.#historyLimit = Math.max(this.#maxActiveExecutions, Math.min(2_000, Math.floor(historyLimit)));
    this.#persistentGrantLimit = Math.max(1, Math.min(2_000, Math.floor(persistentGrantLimit)));
    this.#resourceBudget = automationExecutionResourceBudgetSchema.parse(resourceBudget);
    this.#snapshot = this.#store.load();
    this.#recoverInterruptedExecutions();
  }

  create(input: CreateAutomationExecutionInput): AutomationExecutionRecord {
    const source = automationSourceSchema.parse(input.source);
    const libraryId = automationLibraryIdSchema.parse(input.libraryId);
    const declaredCapabilities = normalizeCapabilities(z.array(automationCapabilitySchema).max(64).parse(input.declaredCapabilities));
    const scriptSource = input.scriptSource;
    if ((source === 'desktop-console' || source === 'script') && typeof scriptSource !== 'string') {
      throw new Error('Desktop Console and saved scripts must provide script source.');
    }
    if ((source === 'desktop-console' || source === 'mcp') && input.sessionId === undefined) {
      throw new Error('Desktop Console and MCP executions must bind a session.');
    }
    const sessionId = input.sessionId === undefined ? null : automationSessionIdSchema.parse(input.sessionId);
    if (this.#activeExecutionCount() >= this.#maxActiveExecutions) {
      const error = new AutomationExecutionJournalError('AUTOMATION_EXECUTION_LIMIT_REACHED');
      this.#logger.error('automation.execution.rejected', error, {
        source,
        libraryId,
        failureCode: error.code,
      });
      throw error;
    }
    const nowDate = this.#clock();
    const now = nowDate.toISOString();
    const scriptHash = scriptSource === undefined ? null : hashScript(scriptSource);
    const record: AutomationExecutionRecord = {
      executionId: this.#nextUniqueId('execution'),
      logId: this.#nextUniqueId('log'),
      source,
      libraryId,
      apiVersion: AUTOMATION_API_VERSION,
      scriptHash,
      sessionId,
      deadlineAt: new Date(nowDate.getTime() + this.#resourceBudget.maxWallTimeMs).toISOString(),
      resourceBudget: { ...this.#resourceBudget },
      declaredCapabilities,
      grantedCapabilities: [],
      status: 'created',
      commandCount: 0,
      succeededCommandCount: 0,
      failedCommandCount: 0,
      lastCommandId: null,
      failureCode: null,
      summary: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    };
    this.#snapshot.executions.push(record);
    this.#trimHistory();
    this.#persist();
    this.#scheduleDeadline(record);
    this.#info('created', record, 'Automation execution created.');
    return safeRecord(record);
  }

  /**
   * Main calls this immediately after `create` and before exposing an
   * execution to a sandbox or MCP connection. The explicit pair of state
   * transitions leaves a durable record of validation without trusting an
   * adapter-provided source or capability payload.
   */
  validate(executionId: string): AutomationExecutionRecord | undefined {
    const record = this.#find(executionId);
    if (!record || record.status !== 'created') return record === undefined ? undefined : safeRecord(record);
    record.status = 'validating';
    record.updatedAt = this.#now();
    this.#persist();
    this.#info('validating', record, 'Automation execution validation started.');
    return safeRecord(record);
  }

  finishValidation(executionId: string): AutomationExecutionRecord | undefined {
    const record = this.#find(executionId);
    if (!record || record.status !== 'validating') return record === undefined ? undefined : safeRecord(record);
    const preAuthorized = record.source === 'script'
      && record.scriptHash !== null
      && this.#hasPersistentGrant(record.scriptHash, record.libraryId, record.declaredCapabilities);
    record.grantedCapabilities = preAuthorized ? [...record.declaredCapabilities] : [];
    record.status = preAuthorized ? 'running' : 'awaiting-authorization';
    record.updatedAt = this.#now();
    this.#persist();
    this.#info(preAuthorized ? 'authorized' : 'awaiting-authorization', record, preAuthorized
      ? 'Saved-script authorization matched.'
      : 'Automation execution is awaiting authorization.');
    return safeRecord(record);
  }

  /** Convenience for the normal Main-owned create → validation sequence. */
  start(executionId: string): AutomationExecutionRecord | undefined {
    const validated = this.validate(executionId);
    if (!validated || validated.status !== 'validating') return validated;
    return this.finishValidation(executionId);
  }

  /**
   * This method deliberately has no caller-controlled `actor` field. Only a
   * trusted Main Desktop UI/TTY entrypoint receives the Journal object; script
   * and MCP adapters receive the resolver/Gateway interfaces alone. Therefore
   * an MCP payload cannot impersonate a desktop user by changing a string.
   */
  authorizeFromDesktop(input: AuthorizeAutomationExecutionInput): AuthorizeAutomationExecutionResult {
    const record = this.#find(input.executionId);
    if (!record) return { ok: false, code: 'AUTOMATION_EXECUTION_NOT_FOUND' };
    if (record.status !== 'awaiting-authorization') {
      return { ok: false, code: 'AUTOMATION_GRANT_NOT_ALLOWED' };
    }
    const allowed = (record.source === 'desktop-console' && input.persistence === 'session')
      || (record.source === 'script' && input.persistence === 'saved-script' && record.scriptHash !== null);
    const mcpSessionGrant = record.source === 'mcp' && input.persistence === 'session';
    if (!allowed && !mcpSessionGrant) return { ok: false, code: 'AUTOMATION_GRANT_NOT_ALLOWED' };

    if (input.persistence === 'saved-script' && record.scriptHash !== null) {
      this.#upsertPersistentGrant({
        scriptHash: record.scriptHash,
        libraryId: record.libraryId,
        capabilities: record.declaredCapabilities,
        grantedAt: this.#now(),
      });
    }
    record.grantedCapabilities = [...record.declaredCapabilities];
    record.status = 'running';
    record.updatedAt = this.#now();
    this.#persist();
    this.#info('authorized', record, 'Automation execution authorized.');
    return { ok: true, execution: safeRecord(record) };
  }

  requestApproval(executionId: string): AutomationExecutionRecord | undefined {
    const record = this.#find(executionId);
    if (!record || record.status !== 'running') return record === undefined ? undefined : safeRecord(record);
    record.status = 'awaiting-approval';
    record.updatedAt = this.#now();
    this.#persist();
    this.#info('awaiting-approval', record, 'Automation execution is awaiting operation approval.');
    return safeRecord(record);
  }

  approve(executionId: string): AutomationExecutionRecord | undefined {
    const record = this.#find(executionId);
    if (!record || record.status !== 'awaiting-approval') return record === undefined ? undefined : safeRecord(record);
    record.status = 'running';
    record.updatedAt = this.#now();
    this.#persist();
    this.#info('approved', record, 'Automation execution operation approval granted.');
    return safeRecord(record);
  }

  resolve(executionId: string): AutomationExecutionContext | undefined {
    const record = this.#find(executionId);
    if (!record || record.status !== 'running') return undefined;
    return {
      executionId: record.executionId,
      source: record.source,
      libraryId: record.libraryId,
      grantedCapabilities: [...record.grantedCapabilities],
      logId: record.logId,
      deadlineAt: record.deadlineAt,
      resourceBudget: { ...record.resourceBudget },
      abortSignal: this.#controllerFor(record.executionId).signal,
    };
  }

  get(executionId: string): AutomationExecutionRecord | undefined {
    const record = this.#find(executionId);
    return record === undefined ? undefined : safeRecord(record);
  }

  list(libraryId?: string): AutomationExecutionRecord[] {
    return this.#snapshot.executions
      .filter((record) => libraryId === undefined || record.libraryId === libraryId)
      .map(safeRecord);
  }

  complete(executionId: string, input: CompleteAutomationExecutionInput): AutomationExecutionRecord | undefined {
    const record = this.#find(executionId);
    if (!record || terminalStatus(record.status)) return record === undefined ? undefined : safeRecord(record);
    if (record.status !== 'running' && record.status !== 'awaiting-approval') {
      throw new Error('Automation execution can only complete after it has started.');
    }
    const status = automationExecutionStatusSchema.parse(input.status);
    if (!terminalStatus(status)) throw new Error('Automation execution must complete with a terminal status.');
    const summary = input.summary === undefined ? null : executionSummarySchema.parse(input.summary);
    const failureCode = input.failureCode === undefined
      ? (status === 'failed' ? 'AUTOMATION_COMMAND_FAILED' : null)
      : automationExecutionFailureCodeSchema.parse(input.failureCode);
    record.status = status;
    record.summary = summary;
    record.failureCode = failureCode;
    record.updatedAt = this.#now();
    record.finishedAt = record.updatedAt;
    if (status === 'cancelled' || status === 'timed-out') {
      this.#abortExecution(record.executionId, status === 'timed-out' ? 'timed-out' : 'cancelled');
    }
    else this.#releaseController(record.executionId);
    this.#persist();
    this.#info('completed', record, 'Automation execution completed.');
    return safeRecord(record);
  }

  cancel(executionId: string): AutomationExecutionRecord | undefined {
    const record = this.#find(executionId);
    if (!record || terminalStatus(record.status)) return record === undefined ? undefined : safeRecord(record);
    record.status = 'cancelled';
    record.failureCode = 'AUTOMATION_CANCELLED';
    record.updatedAt = this.#now();
    record.finishedAt = record.updatedAt;
    this.#abortExecution(record.executionId, 'cancelled');
    this.#persist();
    this.#info('cancelled', record, 'Automation execution cancelled.');
    return safeRecord(record);
  }

  endSession(sessionId: string): void {
    for (const record of this.#snapshot.executions) {
      if (record.sessionId !== sessionId || terminalStatus(record.status)) continue;
      record.status = 'cancelled';
      record.failureCode = 'AUTOMATION_SESSION_ENDED';
      record.updatedAt = this.#now();
      record.finishedAt = record.updatedAt;
      this.#abortExecution(record.executionId, 'cancelled');
      this.#info('cancelled', record, 'Automation session ended.');
    }
    this.#persist();
  }

  recordCommandResult(
    executionId: string,
    commandId: string,
    outcome: 'succeeded' | 'failed',
    failureCode?: string,
  ): void {
    const record = this.#find(executionId);
    if (!record || record.status !== 'running') return;
    record.commandCount++;
    const descriptor = getAutomationCommandDescriptor(commandId);
    if (!descriptor) throw new Error('Automation command audit requires a registered command ID.');
    record.lastCommandId = descriptor.commandId;
    if (outcome === 'succeeded') record.succeededCommandCount++;
    else {
      record.failedCommandCount++;
      record.failureCode = failureCode === undefined
        ? 'AUTOMATION_COMMAND_FAILED'
        : automationExecutionFailureCodeSchema.parse(failureCode);
    }
    record.updatedAt = this.#now();
    this.#persist();
    this.#info('command', record, 'Automation command finished.', {
      commandId: record.lastCommandId,
      outcome,
      ...(failureCode === undefined ? {} : { failureCode: record.failureCode }),
    });
  }

  timeout(executionId: string): AutomationExecutionRecord | undefined {
    const record = this.#find(executionId);
    if (!record || terminalStatus(record.status)) return record === undefined ? undefined : safeRecord(record);
    record.status = 'timed-out';
    record.failureCode = 'AUTOMATION_TIMED_OUT';
    record.updatedAt = this.#now();
    record.finishedAt = record.updatedAt;
    this.#abortExecution(record.executionId, 'timed-out');
    this.#persist();
    this.#info('timed-out', record, 'Automation execution reached its wall-clock deadline.');
    return safeRecord(record);
  }

  #hasPersistentGrant(
    scriptHash: string,
    libraryId: string,
    capabilities: readonly AutomationCapability[],
  ): boolean {
    return this.#snapshot.persistentGrants.some((grant) => (
      grant.scriptHash === scriptHash
      && grant.libraryId === libraryId
      && capabilitySetsEqual(grant.capabilities, capabilities)
    ));
  }

  #upsertPersistentGrant(grant: AutomationPersistentGrant): void {
    const index = this.#snapshot.persistentGrants.findIndex((candidate) => (
      candidate.scriptHash === grant.scriptHash
      && candidate.libraryId === grant.libraryId
      && capabilitySetsEqual(candidate.capabilities, grant.capabilities)
    ));
    if (index === -1) this.#snapshot.persistentGrants.push(grant);
    else this.#snapshot.persistentGrants[index] = grant;
    this.#trimPersistentGrants();
  }

  #recoverInterruptedExecutions(): void {
    let changed = false;
    for (const record of this.#snapshot.executions) {
      if (terminalStatus(record.status)) continue;
      record.status = 'failed';
      record.failureCode = 'AUTOMATION_INTERRUPTED_BY_RESTART';
      record.updatedAt = this.#now();
      record.finishedAt = record.updatedAt;
      changed = true;
      this.#info('interrupted', record, 'Automation execution was interrupted by app restart.');
    }
    if (changed) this.#persist();
  }

  #find(executionId: string): AutomationExecutionRecord | undefined {
    return this.#snapshot.executions.find((record) => record.executionId === executionId);
  }

  #trimHistory(): void {
    if (this.#snapshot.executions.length <= this.#historyLimit) return;
    const terminal = this.#snapshot.executions.filter((record) => terminalStatus(record.status));
    const active = this.#snapshot.executions.filter((record) => !terminalStatus(record.status));
    const terminalSlots = Math.max(0, this.#historyLimit - active.length);
    this.#snapshot.executions = terminalSlots === 0
      ? active
      : [...terminal.slice(-terminalSlots), ...active];
  }

  #trimPersistentGrants(): void {
    if (this.#snapshot.persistentGrants.length <= this.#persistentGrantLimit) return;
    this.#snapshot.persistentGrants.sort((left, right) => left.grantedAt.localeCompare(right.grantedAt));
    this.#snapshot.persistentGrants = this.#snapshot.persistentGrants.slice(-this.#persistentGrantLimit);
  }

  #activeExecutionCount(): number {
    return this.#snapshot.executions.filter((record) => !terminalStatus(record.status)).length;
  }

  #nextUniqueId(prefix: 'execution' | 'log'): string {
    const existing = new Set(this.#snapshot.executions.map((record) => (
      prefix === 'execution' ? record.executionId : record.logId
    )));
    for (let attempt = 0; attempt < 32; attempt++) {
      const id = nonBlankString.parse(this.#newId(prefix));
      if (!existing.has(id)) return id;
    }
    throw new Error(`Could not allocate a unique automation ${prefix} ID.`);
  }

  #controllerFor(executionId: string): AbortController {
    let controller = this.#abortControllers.get(executionId);
    if (!controller) {
      controller = new AbortController();
      this.#abortControllers.set(executionId, controller);
    }
    return controller;
  }

  #scheduleDeadline(record: AutomationExecutionRecord): void {
    const delay = Math.max(0, new Date(record.deadlineAt).getTime() - this.#clock().getTime());
    const timer = setTimeout(() => {
      this.#deadlineTimers.delete(record.executionId);
      this.timeout(record.executionId);
    }, delay);
    timer.unref();
    this.#deadlineTimers.set(record.executionId, timer);
  }

  #abortExecution(executionId: string, reason: 'cancelled' | 'timed-out'): void {
    const controller = this.#abortControllers.get(executionId);
    controller?.abort(reason);
    this.#abortControllers.delete(executionId);
    this.#clearDeadline(executionId);
  }

  #releaseController(executionId: string): void {
    this.#abortControllers.delete(executionId);
    this.#clearDeadline(executionId);
  }

  #clearDeadline(executionId: string): void {
    const timer = this.#deadlineTimers.get(executionId);
    if (timer) clearTimeout(timer);
    this.#deadlineTimers.delete(executionId);
  }

  #persist(): void {
    this.#store.save(this.#snapshot);
  }

  #now(): string {
    return this.#clock().toISOString();
  }

  #info(
    event: string,
    record: AutomationExecutionRecord,
    message: string,
    extras: Record<string, unknown> = {},
  ): void {
    this.#logger.info(`automation.execution.${event}`, message, {
      executionId: record.executionId,
      logId: record.logId,
      source: record.source,
      libraryId: record.libraryId,
      scriptHash: record.scriptHash,
      status: record.status,
      failureCode: record.failureCode,
      ...extras,
    });
  }
}
