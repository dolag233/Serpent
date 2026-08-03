import {
  newQuickJSWASMModule,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
} from 'quickjs-emscripten';
import ts from 'typescript';
import { utf8ByteLength } from '../shared/script-sandbox-limits';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';
import { automationScriptHostFailureFromError } from '../shared/automation-host-command-error';
import { pluginTargetLibraryIdSchema } from '../plugins/plugin-commands';
import {
  SERPENT_GUEST_COMMANDS,
} from './serpent-guest-api';
import { projectPluginStorageResult } from './plugin-storage-result';
import type { PluginDomainEvent } from '../plugins/plugin-domain-events';
import type { PluginHookDecision, PluginHookInvoke } from '../plugins/plugin-hooks';
import type {
  PluginJobComplete,
  PluginJobCheckpoint,
  PluginJobRecord,
} from '../plugins/plugin-jobs';
import type {
  PluginProviderBatchResult,
  PluginProviderInvoke,
} from '../plugins/plugin-providers';
import type {
  PluginSearchChunk,
  PluginSearchComplete,
  PluginSearchEvent,
} from '../plugins/plugin-search';
import type { PluginCommandComplete, PluginCommandInvoke } from '../plugins/plugin-commands';
import type {
  PluginInputCaptureEvent,
  PluginInputCaptureOptions,
} from '../shared/plugin-input-capture';

/**
 * This is an engine-selection prototype, not the public Script Runtime API.
 *
 * It deliberately exposes one innocuous asynchronous host function so that the
 * next slice can prove its Gateway bridge without granting a script Node, IPC,
 * filesystem, network, or database access. The real `serpent` API belongs to
 * the Automation Gateway task, not this module.
 */
export interface QuickJsSandboxPrototypeHost {
  /** Development-only bridge retained for the isolated sandbox preview. */
  readText?(input: string): Promise<string>;
  /**
   * The Runtime supplies this narrowly-scoped Gateway bridge. It is intentionally
   * not a generic IPC, filesystem, SQL, or network function: the sandbox only
   * binds the two public asset methods below to fixed command IDs.
   */
  executeAutomationCommand?(
    commandId: AutomationScriptCommandId,
    input: unknown,
    options?: {
      causeChain?: readonly string[];
      targetLibraryId?: string;
    },
  ): Promise<unknown>;
  /**
   * Plugin Host namespaced KV storage. Not available to Desktop Scripts.
   */
  executeStorageOperation?(input: {
    operation: 'get' | 'set' | 'delete' | 'list' | 'get-directory';
    scope?: 'library' | 'user';
    key?: string;
    value?: unknown;
  }): Promise<unknown>;
  /**
   * Long-lived plugin Host sessions park setup() on this bridge until Main
   * requests deactivate. Scripts never receive this surface.
   */
  waitUntilDeactivate?(): Promise<void>;
  getDeactivateReason?(): string | undefined;
  signal?: AbortSignal;
  /**
   * Plugin Host domain-event pull. Resolves with the next event or null when
   * the instance is deactivating.
   */
  waitForDomainEvent?(): Promise<PluginDomainEvent | null>;
  /**
   * Plugin Host onWill hook invoke pull. Resolves with the next invoke or null
   * when the instance is deactivating.
   */
  waitForHookInvoke?(): Promise<PluginHookInvoke | null>;
  /**
   * Posts an onWill decision back to Main for a pending hook invoke.
   */
  respondHookDecision?(
    invokeId: string,
    decision: PluginHookDecision,
  ): Promise<void>;
  waitForJobInvoke?(): Promise<PluginJobRecord | null>;
  respondJobComplete?(
    jobId: string,
    complete: PluginJobComplete,
  ): Promise<void>;
  waitForProviderInvoke?(): Promise<PluginProviderInvoke | null>;
  respondProviderComplete?(
    invokeId: string,
    result: PluginProviderBatchResult,
  ): Promise<void>;
  waitForSearchEvent?(): Promise<PluginSearchEvent | null>;
  respondSearchChunk?(
    chunk: PluginSearchChunk,
  ): Promise<void>;
  respondSearchComplete?(
    complete: PluginSearchComplete,
  ): Promise<void>;
  enqueuePluginJob?(input: {
    handlerId: string;
    payload: Record<string, unknown>;
    recoveryStrategy?: 'idempotent' | 'checkpoint';
    targetLibraryId?: string;
  }): Promise<unknown>;
  reportJobProgress?(input: {
    jobId: string;
    completed: number;
    total: number;
    phase?: string;
    message?: string;
    progress?: number;
    targetLibraryId?: string;
  }): Promise<void>;
  controlPluginJob?(input: {
    jobId: string;
    action: 'pause' | 'resume' | 'cancel' | 'retry';
    reason?: string;
    retryInput?: Record<string, unknown>;
    checkpoint?: PluginJobCheckpoint;
    targetLibraryId?: string;
  }): Promise<unknown>;
  isJobAborted?(jobId: string): boolean;
  waitForCommandInvoke?(): Promise<PluginCommandInvoke | null>;
  respondCommandComplete?(
    invokeId: string,
    complete: PluginCommandComplete,
  ): Promise<void>;
  /**
   * Sets the cause chain inherited by subsequent host commands until cleared.
   */
  setActiveCauseChain?(causeChain: readonly string[]): void;
  requestInputCapture?(input: PluginInputCaptureOptions): Promise<{
    sessionId: string;
  }>;
  releaseInputCapture?(sessionId: string): void;
  waitForInputCaptureEvent?(
    sessionId: string,
  ): Promise<PluginInputCaptureEvent | null>;
}

export interface QuickJsSandboxPrototypeLimits {
  cpuTimeoutMs: number;
  wallTimeoutMs: number;
  memoryLimitBytes: number;
  maxStackBytes: number;
  maxOutputBytes: number;
  maxPendingHostCalls: number;
  /** Hard cap on unsettled guest promises created by user code. */
  maxPendingGuestPromises: number;
  /** Fallback bound on microtask advancement because QuickJS does not expose queue length. */
  maxPendingJobBatches: number;
  /** Reject source before TypeScript parses it. */
  maxSourceBytes: number;
}

export interface QuickJsSandboxPrototypeOptions extends Partial<QuickJsSandboxPrototypeLimits> {
  /** Cooperative cancellation while the engine is between guest instructions or awaiting a host promise. */
  signal?: AbortSignal;
}

export const DEFAULT_QUICKJS_SANDBOX_PROTOTYPE_LIMITS: Readonly<QuickJsSandboxPrototypeLimits> = {
  cpuTimeoutMs: 200,
  wallTimeoutMs: 1_000,
  memoryLimitBytes: 8 * 1024 * 1024,
  maxStackBytes: 512 * 1024,
  maxOutputBytes: 16 * 1024,
  maxPendingHostCalls: 8,
  maxPendingGuestPromises: 64,
  maxPendingJobBatches: 256,
  maxSourceBytes: 64 * 1024,
};

export type QuickJsSandboxPrototypeErrorCode =
  | 'SOURCE_NOT_ALLOWED'
  | 'SOURCE_TOO_LARGE'
  | 'CPU_TIMEOUT'
  | 'WALL_TIMEOUT'
  | 'CANCELLED'
  | 'MEMORY_LIMIT'
  | 'OUTPUT_LIMIT'
  | 'HOST_CALL_LIMIT'
  | 'PROMISE_LIMIT'
  | 'RUNTIME_ERROR';

export class QuickJsSandboxPrototypeError extends Error {
  public readonly code: QuickJsSandboxPrototypeErrorCode;
  public readonly guestStack?: string;

  public constructor(
    code: QuickJsSandboxPrototypeErrorCode,
    message: string,
    guestStack?: string,
  ) {
    super(message);
    this.name = 'QuickJsSandboxPrototypeError';
    this.code = code;
    this.guestStack = guestStack;
  }
}

export interface QuickJsSandboxPrototypeResult {
  value: unknown;
  output: string[];
  transpiledJavaScript: string;
}

interface GuestErrorLike {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
}

interface TrackedGuestPromise {
  /** A durable duplicate: function callback arguments must not be retained. */
  readonly promise: QuickJSHandle;
  /** Kept alive so QuickJS can call it when the promise settles. */
  onSettled: QuickJSHandle;
}

function mergeLimits(
  options: QuickJsSandboxPrototypeOptions | undefined,
): QuickJsSandboxPrototypeLimits {
  const { signal, ...overrides } = options ?? {};
  void signal;
  const limits = { ...DEFAULT_QUICKJS_SANDBOX_PROTOTYPE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Sandbox limit ${name} must be a positive integer.`);
    }
  }
  return limits;
}

function assertSourceIsAllowed(source: string, fileName: string): void {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  let rejected: string | undefined;
  const visit = (node: ts.Node): void => {
    if (rejected) return;
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)) {
      rejected = 'Modules are not available in Serpent scripts.';
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      rejected = 'Dynamic import is not available in Serpent scripts.';
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'eval' || node.expression.text === 'Function')
    ) {
      rejected = 'Dynamic code construction is not available in Serpent scripts.';
      return;
    }
    if (ts.isIdentifier(node) && node.text === 'globalThis') {
      rejected = 'Global-object reflection is not available in Serpent scripts.';
      return;
    }
    if (
      ts.isFunctionLike(node) &&
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) &&
      'asteriskToken' in node &&
      node.asteriskToken
    ) {
      rejected = 'Async generators are not available in Serpent scripts.';
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (rejected) {
    throw new QuickJsSandboxPrototypeError('SOURCE_NOT_ALLOWED', rejected);
  }
}

function assertSourceWithinLimit(source: string, maxSourceBytes: number): void {
  if (utf8ByteLength(source) > maxSourceBytes) {
    throw new QuickJsSandboxPrototypeError(
      'SOURCE_TOO_LARGE',
      `The script exceeds the ${maxSourceBytes}-byte source limit.`,
    );
  }
}

/**
 * Compile a script body, not an ES module. A later Script Runtime may wrap a
 * saved `export default async function` entrypoint before calling this engine.
 */
export function transpileQuickJsSandboxPrototypeSource(source: string, fileName = 'script.serpent.ts'): string {
  assertSourceIsAllowed(source, fileName);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      sourceMap: false,
      inlineSourceMap: false,
      inlineSources: false,
    },
    fileName,
    reportDiagnostics: true,
  });
  const diagnostic = transpiled.diagnostics?.find(
    (candidate) => candidate.category === ts.DiagnosticCategory.Error,
  );
  if (diagnostic) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    throw new QuickJsSandboxPrototypeError('SOURCE_NOT_ALLOWED', `TypeScript transpile error: ${message}`);
  }
  return transpiled.outputText;
}

const PENDING_PROMISE_LIMIT_MARKER = '__SERPENT_PENDING_PROMISE_LIMIT__';

function hasAsyncModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false);
}

function privateIdentifier(prefix: string): string {
  const entropy = new Uint32Array(3);
  globalThis.crypto.getRandomValues(entropy);
  return `__serpent_${prefix}_${entropy[0]!.toString(36)}${entropy[1]!.toString(36)}${entropy[2]!.toString(36)}`;
}

function instrumentAsyncFunctions(
  source: string,
  trackIdentifier: string,
): string {
  const sourceFile = ts.createSourceFile(
    'script.serpent.instrumented.js',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const factory = ts.factory;
  const track = (promise: ts.Expression): ts.CallExpression => factory.createCallExpression(
    factory.createIdentifier(trackIdentifier),
    undefined,
    [promise],
  );
  const withoutAsync = <T extends ts.ModifierLike>(modifiers: readonly T[] | undefined) =>
    modifiers?.filter((modifier) => modifier.kind !== ts.SyntaxKind.AsyncKeyword);
  const invokeWithCurrentReceiver = (functionExpression: ts.FunctionExpression): ts.CallExpression =>
    factory.createCallExpression(
      factory.createPropertyAccessExpression(functionExpression, 'apply'),
      undefined,
      [factory.createThis(), factory.createIdentifier('arguments')],
    );
  const asyncArrowWithCapturedParameters = (body: ts.ConciseBody): ts.CallExpression =>
    factory.createCallExpression(
      factory.createArrowFunction(
        [factory.createModifier(ts.SyntaxKind.AsyncKeyword)],
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        body,
      ),
      undefined,
      [],
    );
  const returnTracked = (expression: ts.Expression): ts.Block => factory.createBlock([
    factory.createReturnStatement(track(expression)),
  ], true);
  const asyncFunctionExpression = (
    modifiers: readonly ts.ModifierLike[] | undefined,
    name: ts.Identifier | undefined,
    parameters: readonly ts.ParameterDeclaration[],
    body: ts.Block,
  ): ts.FunctionExpression => factory.createFunctionExpression(
    modifiers?.filter(
      (modifier): modifier is ts.Modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword,
    ),
    undefined,
    name,
    undefined,
    parameters,
    undefined,
    body,
  );

  const methodAsAsyncFunction = (method: ts.MethodDeclaration): ts.FunctionExpression =>
    asyncFunctionExpression(method.modifiers, undefined, method.parameters, method.body!);

  const transformer: ts.TransformerFactory<ts.SourceFile> = (transformationContext) => {
    const visit: ts.Visitor = (node) => {
      const visited = ts.visitEachChild(node, visit, transformationContext);
      if (!hasAsyncModifier(visited)) return visited;
      if (ts.isFunctionDeclaration(visited)) {
        const inner = asyncFunctionExpression(
          visited.modifiers,
          visited.name,
          visited.parameters,
          visited.body!,
        );
        return factory.updateFunctionDeclaration(
          visited,
          withoutAsync(visited.modifiers),
          undefined,
          visited.name,
          visited.typeParameters,
          visited.parameters,
          visited.type,
          returnTracked(invokeWithCurrentReceiver(inner)),
        );
      }
      if (ts.isFunctionExpression(visited)) {
        const inner = asyncFunctionExpression(
          visited.modifiers,
          visited.name,
          visited.parameters,
          visited.body,
        );
        return factory.updateFunctionExpression(
          visited,
          withoutAsync(visited.modifiers),
          undefined,
          visited.name,
          visited.typeParameters,
          visited.parameters,
          visited.type,
          returnTracked(invokeWithCurrentReceiver(inner)),
        );
      }
      if (ts.isArrowFunction(visited)) {
        return factory.updateArrowFunction(
          visited,
          withoutAsync(visited.modifiers),
          visited.typeParameters,
          visited.parameters,
          visited.type,
          visited.equalsGreaterThanToken,
          track(asyncArrowWithCapturedParameters(visited.body)),
        );
      }
      if (ts.isMethodDeclaration(visited)) {
        const inner = methodAsAsyncFunction(visited);
        return factory.updateMethodDeclaration(
          visited,
          withoutAsync(visited.modifiers),
          undefined,
          visited.name,
          visited.questionToken,
          visited.typeParameters,
          visited.parameters,
          visited.type,
          returnTracked(invokeWithCurrentReceiver(inner)),
        );
      }
      return visited;
    };
    return (file) => ts.visitNode(file, visit) as ts.SourceFile;
  };

  const transformed = ts.transform(sourceFile, [transformer]);
  try {
    return ts.createPrinter().printFile(transformed.transformed[0]!);
  } finally {
    transformed.dispose();
  }
}

/**
 * QuickJS does not expose a pending-promise count. A host callback inspects
 * each generated promise's actual state, owns the active handle until it
 * settles, and therefore enforces the budget without treating an already
 * fulfilled `Promise.resolve()` as unfinished work.
 *
 * The helper identifiers are random per execution and live only in this
 * wrapper's lexical scope. Dynamic source construction and prototype/global
 * reflection are rejected before transpilation so guest code cannot discover
 * or invoke those private helpers to forge a release.
 */
function buildPromiseBudgetHarness(
  transpiledJavaScript: string,
  hostTrackerIdentifier: string,
): string {
  const nativePromiseIdentifier = privateIdentifier('native_promise');
  const nativeThenIdentifier = privateIdentifier('native_then');
  const functionPrototypeIdentifier = privateIdentifier('function_prototype');
  const asyncFunctionPrototypeIdentifier = privateIdentifier('async_function_prototype');
  const generatorFunctionPrototypeIdentifier = privateIdentifier('generator_function_prototype');
  const trackIdentifier = privateIdentifier('track_promise');
  const replacementIdentifier = privateIdentifier('promise_constructor');
  const instrumentedJavaScript = instrumentAsyncFunctions(
    transpiledJavaScript,
    trackIdentifier,
  );

  return `(function () {
    "use strict";
    const ${trackIdentifier} = ${hostTrackerIdentifier};
    const ${nativePromiseIdentifier} = Promise;
    const ${nativeThenIdentifier} = ${nativePromiseIdentifier}.prototype.then;
    const ${replacementIdentifier} = function Promise(executor) {
      if (typeof executor !== "function") {
        throw new TypeError("Promise resolver is not a function");
      }
      return ${trackIdentifier}(new ${nativePromiseIdentifier}(executor));
    };
    ${replacementIdentifier}.prototype = ${nativePromiseIdentifier}.prototype;
    Object.defineProperties(${replacementIdentifier}, {
      resolve: { value: (value) => ${trackIdentifier}(${nativePromiseIdentifier}.resolve(value)) },
      reject: { value: (reason) => ${trackIdentifier}(${nativePromiseIdentifier}.reject(reason)) },
      all: { value: (values) => ${trackIdentifier}(${nativePromiseIdentifier}.all(values)) },
      allSettled: { value: (values) => ${trackIdentifier}(${nativePromiseIdentifier}.allSettled(values)) },
      any: { value: (values) => ${trackIdentifier}(${nativePromiseIdentifier}.any(values)) },
      race: { value: (values) => ${trackIdentifier}(${nativePromiseIdentifier}.race(values)) }
    });
    ${nativePromiseIdentifier}.prototype.then = function (...args) {
      return ${trackIdentifier}(${nativeThenIdentifier}.call(this, ...args));
    };
    Object.defineProperty(${nativePromiseIdentifier}.prototype, "constructor", {
      value: ${replacementIdentifier},
      writable: false,
      configurable: false,
    });
    const ${functionPrototypeIdentifier} = Object.getPrototypeOf(function () {});
    const ${asyncFunctionPrototypeIdentifier} = Object.getPrototypeOf(async function () {});
    const ${generatorFunctionPrototypeIdentifier} = Object.getPrototypeOf(function* () {});
    Object.defineProperty(${functionPrototypeIdentifier}, "constructor", {
      value: undefined,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(${asyncFunctionPrototypeIdentifier}, "constructor", {
      value: undefined,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(${generatorFunctionPrototypeIdentifier}, "constructor", {
      value: undefined,
      writable: false,
      configurable: false,
    });
    Object.freeze(${nativePromiseIdentifier}.prototype);
    Object.freeze(${replacementIdentifier});
    Object.defineProperty(globalThis, "Promise", {
      value: ${replacementIdentifier},
      writable: false,
      configurable: false,
    });
    return ${trackIdentifier}((async function () {
${instrumentedJavaScript}
    }).call(undefined));
  })()`;
}

function stringifyGuestValue(context: QuickJSContext, handle: QuickJSHandle): string {
  return stringifyValue(context.dump(handle));
}

/**
 * Console and result-size accounting must never turn an otherwise valid
 * ES2022 value such as a BigInt into a host-side TypeError. This is display
 * text only, not a value serialization contract for the future Script API.
 */
function stringifyValue(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested === 'bigint') return `${nested}n`;
    if (typeof nested === 'object' && nested !== null) {
      if (seen.has(nested)) return '[Circular]';
      seen.add(nested);
    }
    return nested;
  });
  return serialized === undefined ? String(value) : serialized;
}

function guestError(
  context: QuickJSContext,
  handle: QuickJSHandle,
  cancellationRequested = false,
): QuickJsSandboxPrototypeError {
  const dumped = context.dump(handle) as GuestErrorLike | string;
  const details = typeof dumped === 'object' && dumped !== null ? dumped : {};
  const message = typeof details.message === 'string' ? details.message : String(dumped);
  const guestStack = typeof details.stack === 'string' ? details.stack : undefined;
  const lower = `${message}\n${guestStack ?? ''}`.toLowerCase();
  if (lower.includes(PENDING_PROMISE_LIMIT_MARKER.toLowerCase())) {
    return new QuickJsSandboxPrototypeError(
      'PROMISE_LIMIT',
      'The script created too many unfinished Promises.',
      guestStack,
    );
  }
  if (lower.includes('exceeded its output limit')) {
    return new QuickJsSandboxPrototypeError('OUTPUT_LIMIT', 'The script exceeded its output limit.', guestStack);
  }
  if (lower.includes('pending host-call limit')) {
    return new QuickJsSandboxPrototypeError('HOST_CALL_LIMIT', 'The script exceeded its pending host-call limit.', guestStack);
  }
  if (lower.includes('out of memory')) {
    return new QuickJsSandboxPrototypeError('MEMORY_LIMIT', 'The script exceeded its memory limit.', guestStack);
  }
  if (lower.includes('interrupted')) {
    if (cancellationRequested) {
      return new QuickJsSandboxPrototypeError('CANCELLED', 'The script was cancelled.', guestStack);
    }
    return new QuickJsSandboxPrototypeError('CPU_TIMEOUT', 'The script exceeded its CPU time limit.', guestStack);
  }
  return new QuickJsSandboxPrototypeError('RUNTIME_ERROR', message, guestStack);
}

function disposeDeferreds(deferreds: Set<QuickJSDeferredPromise>): void {
  for (const deferred of deferreds) {
    deferred.dispose();
  }
  deferreds.clear();
}

/**
 * Convert a JSON-safe host result without generating/evaluating guest source.
 * Automation Gateway contracts are JSON values, so QuickJS's own JSON parser
 * gives the guest a normal isolated value rather than a host object reference.
 */
function newQuickJsJsonValue(context: QuickJSContext, value: unknown): QuickJSHandle {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return context.undefined;
  const json = context.getProp(context.global, 'JSON');
  try {
    const parse = context.getProp(json, 'parse');
    try {
      const source = context.newString(serialized);
      try {
        const parsed = context.callFunction(parse, json, source);
        if (parsed.error) {
          const error = guestError(context, parsed.error);
          parsed.error.dispose();
          throw error;
        }
        return parsed.value;
      } finally {
        source.dispose();
      }
    } finally {
      parse.dispose();
    }
  } finally {
    json.dispose();
  }
}

async function waitForGuestPromise(
  context: QuickJSContext,
  promiseHandle: QuickJSHandle,
  runtime: QuickJSRuntime,
  deadline: number,
  isCancelled: () => boolean,
  maxPendingJobBatches: number,
  afterPendingJobs: () => void,
): Promise<QuickJSHandle> {
  let pendingJobBatches = 0;
  while (true) {
    const state = context.getPromiseState(promiseHandle);
    if (state.type === 'fulfilled') return state.value;
    if (state.type === 'rejected') {
      const error = guestError(context, state.error, isCancelled());
      state.error.dispose();
      throw error;
    }
    if (isCancelled()) {
      throw new QuickJsSandboxPrototypeError('CANCELLED', 'The script was cancelled.');
    }
    if (Date.now() >= deadline) {
      throw new QuickJsSandboxPrototypeError('WALL_TIMEOUT', 'The script exceeded its wall-clock time limit.');
    }

    const pendingJobs = runtime.executePendingJobs(128);
    try {
      if (pendingJobs.error) {
        const error = guestError(context, pendingJobs.error, isCancelled());
        pendingJobs.error.dispose();
        throw error;
      }
      if (pendingJobs.value > 0) {
        pendingJobBatches += 1;
        if (pendingJobBatches > maxPendingJobBatches) {
          throw new QuickJsSandboxPrototypeError(
            'PROMISE_LIMIT',
            'The script exceeded its pending Promise work limit.',
          );
        }
      }
    } finally {
      // A tracked callback cannot dispose itself while QuickJS is invoking it.
      // Release those handles only after the whole job batch has returned.
      afterPendingJobs();
    }
    // Give a host bridge promise a chance to settle. This is intentionally a
    // bounded, explicit pump rather than relying on `resolvePromise`, which
    // cannot make a QuickJS promise progress by itself.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Runs an untrusted JS/TS script body in a fresh QuickJS/WASM module.
 *
 * The returned promise is intentionally only an engine proof. The production
 * runner must place this in a separately terminable UtilityProcess and replace
 * `readText` with schema-validated Gateway RPC.
 */
export async function runQuickJsSandboxPrototype(
  source: string,
  host: QuickJsSandboxPrototypeHost,
  options?: QuickJsSandboxPrototypeOptions,
): Promise<QuickJsSandboxPrototypeResult> {
  const limits = mergeLimits(options);
  assertSourceWithinLimit(source, limits.maxSourceBytes);
  const transpiledJavaScript = transpileQuickJsSandboxPrototypeSource(source);
  const quickJs = await newQuickJSWASMModule();
  const runtime = quickJs.newRuntime();
  const startedAt = Date.now();
  let active = true;
  let pendingHostCalls = 0;
  let cancellationRequested = options?.signal?.aborted ?? false;
  let outputBytes = 0;
  const output: string[] = [];
  const deferreds = new Set<QuickJSDeferredPromise>();
  const trackedGuestPromises = new Set<TrackedGuestPromise>();
  const retiredPromiseCallbacks = new Set<QuickJSHandle>();
  let nativePromiseThen: QuickJSHandle | undefined;
  let promiseTracker: QuickJSHandle | undefined;

  runtime.setMemoryLimit(limits.memoryLimitBytes);
  runtime.setMaxStackSize(limits.maxStackBytes);
  const abort = (): void => {
    cancellationRequested = true;
  };
  options?.signal?.addEventListener('abort', abort, { once: true });
  runtime.setInterruptHandler(
    () => cancellationRequested || Date.now() - startedAt >= limits.cpuTimeoutMs,
  );
  const context = runtime.newContext();
  // The generated promise-budget closure keeps the original Promise constructor
  // private. Remove dynamic code constructors from the guest global so user
  // source cannot create an uninstrumented async function at runtime.
  context.setProp(context.global, 'eval', context.undefined);
  context.setProp(context.global, 'Function', context.undefined);
  context.setProp(context.global, 'Reflect', context.undefined);

  const disposeRetiredPromiseCallbacks = (): void => {
    for (const callback of retiredPromiseCallbacks) {
      callback.dispose();
    }
    retiredPromiseCallbacks.clear();
  };

  const disposePromiseTracking = (): void => {
    for (const tracked of trackedGuestPromises) {
      tracked.promise.dispose();
      tracked.onSettled.dispose();
    }
    trackedGuestPromises.clear();
    disposeRetiredPromiseCallbacks();
    promiseTracker?.dispose();
    promiseTracker = undefined;
    nativePromiseThen?.dispose();
    nativePromiseThen = undefined;
  };

  const appendOutput = (line: string): void => {
    const nextBytes = outputBytes + utf8ByteLength(line);
    if (nextBytes > limits.maxOutputBytes) {
      throw new QuickJsSandboxPrototypeError('OUTPUT_LIMIT', 'The script exceeded its output limit.');
    }
    outputBytes = nextBytes;
    output.push(line);
  };

  const settleHostPromise = (
    deferred: QuickJSDeferredPromise,
    settle: () => void,
  ): void => {
    if (!active) return;
    try {
      settle();
      void deferred.settled.finally(() => {
        pendingHostCalls -= 1;
        deferreds.delete(deferred);
        deferred.dispose();
        if (active) {
          const pendingJobs = runtime.executePendingJobs();
          if (pendingJobs.error) pendingJobs.error.dispose();
          disposeRetiredPromiseCallbacks();
        }
      });
    } catch {
      pendingHostCalls -= 1;
      deferreds.delete(deferred);
      deferred.dispose();
    }
  };

  try {
    const nativePromise = context.getProp(context.global, 'Promise');
    try {
      const nativePromisePrototype = context.getProp(nativePromise, 'prototype');
      try {
        nativePromiseThen = context.getProp(nativePromisePrototype, 'then');
      } finally {
        nativePromisePrototype.dispose();
      }
    } finally {
      nativePromise.dispose();
    }

    const promiseTrackerIdentifier = privateIdentifier('host_track_promise');
    promiseTracker = context.newFunction(promiseTrackerIdentifier, (promiseHandle) => {
      if (
        Array.from(trackedGuestPromises).some((tracked) =>
          context.sameValue(tracked.promise, promiseHandle))
      ) {
        return promiseHandle;
      }

      const state = context.getPromiseState(promiseHandle);
      if (state.type === 'fulfilled') {
        state.value.dispose();
        return promiseHandle;
      }
      if (state.type === 'rejected') {
        state.error.dispose();
        return promiseHandle;
      }
      if (trackedGuestPromises.size >= limits.maxPendingGuestPromises) {
        throw new Error(PENDING_PROMISE_LIMIT_MARKER);
      }

      const tracked: TrackedGuestPromise = {
        promise: promiseHandle.dup(),
        // Replaced before this record is made observable to guest code.
        onSettled: context.undefined,
      };
      const onSettled = context.newFunction('settled', () => {
        if (trackedGuestPromises.delete(tracked)) {
          tracked.promise.dispose();
          // This function is currently executing. Dispose it after QuickJS has
          // finished the job batch instead of invalidating its live handle.
          retiredPromiseCallbacks.add(tracked.onSettled);
        }
        return context.undefined;
      });
      tracked.onSettled = onSettled;
      trackedGuestPromises.add(tracked);

      const observation = context.callFunction(
        nativePromiseThen!,
        promiseHandle,
        onSettled,
        onSettled,
      );
      if (observation.error) {
        trackedGuestPromises.delete(tracked);
        tracked.promise.dispose();
        tracked.onSettled.dispose();
        const error = guestError(context, observation.error, cancellationRequested);
        observation.error.dispose();
        throw error;
      }
      observation.value.dispose();
      return promiseHandle;
    });
    context.setProp(context.global, promiseTrackerIdentifier, promiseTracker);

    const createDeferredHostCall = (
      request: Promise<unknown>,
      toGuestValue: (value: unknown) => QuickJSHandle,
    ): QuickJSHandle => {
      if (pendingHostCalls >= limits.maxPendingHostCalls) {
        throw new QuickJsSandboxPrototypeError('HOST_CALL_LIMIT', 'The script exceeded its pending host-call limit.');
      }
      const deferred = context.newPromise();
      pendingHostCalls += 1;
      deferreds.add(deferred);
      void request.then(
        (value) => {
          settleHostPromise(deferred, () => {
            const guestValue = toGuestValue(value);
            try {
              deferred.resolve(guestValue);
            } finally {
              guestValue.dispose();
            }
          });
        },
        (error: unknown) => {
          settleHostPromise(deferred, () => {
            const failure = automationScriptHostFailureFromError(error);
            const guestError = context.newError(failure?.message ?? 'The host request failed.');
            try {
              if (failure !== undefined) {
                const code = context.newString(failure.code);
                try {
                  context.setProp(guestError, 'code', code);
                } finally {
                  code.dispose();
                }
                if ('reason' in failure && failure.reason !== undefined) {
                  const reason = context.newString(failure.reason);
                  try {
                    context.setProp(guestError, 'reason', reason);
                  } finally {
                    reason.dispose();
                  }
                }
                if ('currentEntityVersion' in failure && failure.currentEntityVersion !== undefined) {
                  const version = context.newNumber(failure.currentEntityVersion);
                  try {
                    context.setProp(guestError, 'currentEntityVersion', version);
                  } finally {
                    version.dispose();
                  }
                }
              }
              deferred.reject(guestError);
            } finally {
              guestError.dispose();
            }
          });
        },
      );
      return deferred.handle;
    };

    const serpent = context.newObject();
    let scopedPluginJobsFactory: ((targetLibraryId?: string, includeControl?: boolean) => QuickJSHandle) | undefined;
    const consoleObject = context.newObject();
    const log = context.newFunction('log', (...args) => {
      appendOutput(args.map((arg) => stringifyGuestValue(context, arg)).join(' '));
    });
    if (host.readText !== undefined) {
      const readText = context.newFunction('readText', (inputHandle) => createDeferredHostCall(
        host.readText!(context.getString(inputHandle)),
        (value) => context.newString(String(value)),
      ));
      context.setProp(serpent, 'readText', readText);
      readText.dispose();
    }
    if (host.waitUntilDeactivate !== undefined) {
      const waitUntilDeactivate = context.newFunction('__waitUntilDeactivate', () => createDeferredHostCall(
        host.waitUntilDeactivate!(),
        () => context.undefined,
      ));
      context.setProp(serpent, '__waitUntilDeactivate', waitUntilDeactivate);
      waitUntilDeactivate.dispose();
    }
    if (host.getDeactivateReason !== undefined) {
      const getDeactivateReason = context.newFunction('__getDeactivateReason', () => {
        const reason = host.getDeactivateReason?.();
        return reason === undefined ? context.undefined : context.newString(reason);
      });
      context.setProp(serpent, '__getDeactivateReason', getDeactivateReason);
      getDeactivateReason.dispose();
    }
    if (host.signal !== undefined) {
      const isDeactivated = context.newFunction('__isDeactivated', () => (
        host.signal?.aborted === true ? context.true : context.false
      ));
      context.setProp(serpent, '__isDeactivated', isDeactivated);
      isDeactivated.dispose();
    }
    if (host.waitForDomainEvent !== undefined) {
      const events = context.newObject();
      const next = context.newFunction('next', () => createDeferredHostCall(
        host.waitForDomainEvent!(),
        (value) => (value === null ? context.null : newQuickJsJsonValue(context, value)),
      ));
      context.setProp(events, 'next', next);
      next.dispose();
      if (host.setActiveCauseChain !== undefined) {
        const setCause = context.newFunction('__setCause', (chainHandle) => {
          const dumped = context.dump(chainHandle);
          const causeChain = Array.isArray(dumped)
            ? dumped.map((entry) => String(entry))
            : [];
          host.setActiveCauseChain!(causeChain);
          return context.undefined;
        });
        context.setProp(events, '__setCause', setCause);
        setCause.dispose();
      }
      context.setProp(serpent, 'events', events);
      events.dispose();
    }
    if (host.waitForHookInvoke !== undefined && host.respondHookDecision !== undefined) {
      const hooks = context.newObject();
      const nextInvoke = context.newFunction('__nextInvoke', () => createDeferredHostCall(
        host.waitForHookInvoke!(),
        (value) => (value === null ? context.null : newQuickJsJsonValue(context, value)),
      ));
      context.setProp(hooks, '__nextInvoke', nextInvoke);
      nextInvoke.dispose();
      const respond = context.newFunction('__respond', (invokeIdHandle, decisionHandle) => createDeferredHostCall(
        host.respondHookDecision!(
          String(context.dump(invokeIdHandle)),
          context.dump(decisionHandle) as PluginHookDecision,
        ),
        () => context.undefined,
      ));
      context.setProp(hooks, '__respond', respond);
      respond.dispose();
      context.setProp(serpent, 'hooks', hooks);
      hooks.dispose();
    }
    if (
      host.waitForJobInvoke !== undefined
      && host.respondJobComplete !== undefined
      && host.enqueuePluginJob !== undefined
    ) {
      const createPluginJobsApi = (targetLibraryId?: string, includeControl = false): QuickJSHandle => {
        const jobs = context.newObject();
        const enqueue = (inputHandle: QuickJSHandle) => {
          const input = context.dump(inputHandle) as {
            handlerId?: string;
            payload?: Record<string, unknown>;
            recoveryStrategy?: 'idempotent' | 'checkpoint';
          };
          return createDeferredHostCall(
            host.enqueuePluginJob!({
              handlerId: String(input.handlerId ?? ''),
              payload: input.payload ?? {},
              ...(input.recoveryStrategy === undefined ? {} : { recoveryStrategy: input.recoveryStrategy }),
              ...(targetLibraryId === undefined ? {} : { targetLibraryId }),
            }),
            (value) => newQuickJsJsonValue(context, value),
          );
        };
        const enqueueJob = context.newFunction('enqueue', enqueue);
        context.setProp(jobs, includeControl ? '__enqueue' : 'enqueue', enqueueJob);
        enqueueJob.dispose();
        if (host.reportJobProgress !== undefined) {
          const reportProgress = context.newFunction('reportProgress', (inputHandle) => {
            const input = context.dump(inputHandle) as {
              jobId?: unknown;
              completed?: unknown;
              total?: unknown;
              phase?: unknown;
              message?: unknown;
              progress?: unknown;
            };
            const completedValue = Number(input.completed);
            const totalValue = Number(input.total);
            const progressValue = Number(input.progress);
            const completed = Number.isFinite(completedValue) ? Math.max(0, completedValue) : 0;
            const total = Number.isFinite(totalValue) ? Math.max(completed, totalValue) : completed;
            const progress = Number.isFinite(progressValue)
              ? Math.min(1, Math.max(0, progressValue))
              : (total > 0 ? Math.min(1, completed / total) : 0);
            return createDeferredHostCall(
              host.reportJobProgress!({
                jobId: String(input.jobId ?? ''),
                completed,
                total,
                ...(typeof input.phase === 'string' ? { phase: input.phase.slice(0, 128) } : {}),
                ...(typeof input.message === 'string' ? { message: input.message.slice(0, 4096) } : {}),
                progress,
                ...(targetLibraryId === undefined ? {} : { targetLibraryId }),
              }),
              () => context.undefined,
            );
          });
          context.setProp(jobs, includeControl ? '__reportProgress' : 'reportProgress', reportProgress);
          reportProgress.dispose();
        }
        if (host.controlPluginJob !== undefined) {
          const invokeControl = (action: 'pause' | 'resume' | 'cancel' | 'retry', inputHandle: QuickJSHandle) => {
            const dumped = context.dump(inputHandle);
            const input = dumped !== null && typeof dumped === 'object' && !Array.isArray(dumped)
              ? dumped as {
              jobId?: unknown;
              reason?: unknown;
              retryInput?: Record<string, unknown>;
              checkpoint?: PluginJobCheckpoint;
                }
              : {};
            return createDeferredHostCall(
              host.controlPluginJob!({
                jobId: String(input.jobId ?? ''),
                action,
                ...(typeof input.reason === 'string' ? { reason: input.reason.slice(0, 1_024) } : {}),
                ...(input.retryInput === undefined ? {} : { retryInput: input.retryInput }),
                ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
                ...(targetLibraryId === undefined ? {} : { targetLibraryId }),
              }),
              (value) => newQuickJsJsonValue(context, value),
            );
          };
          if (includeControl) {
            const controlJob = context.newFunction('control', (inputHandle: QuickJSHandle) => {
              const dumped = context.dump(inputHandle);
              const input = dumped !== null && typeof dumped === 'object' && !Array.isArray(dumped)
                ? dumped as { action?: unknown }
                : {};
              const action = input.action === 'pause' || input.action === 'resume' || input.action === 'retry'
                ? input.action
                : 'cancel';
              return invokeControl(action, inputHandle);
            });
            context.setProp(jobs, '__control', controlJob);
            controlJob.dispose();
          } else {
            for (const action of ['cancel', 'pause', 'resume', 'retry'] as const) {
              const control = context.newFunction(action, (inputHandle: QuickJSHandle) => (
                invokeControl(action, inputHandle)
              ));
              context.setProp(jobs, action, control);
              control.dispose();
            }
          }
        }
        if (includeControl && host.isJobAborted !== undefined) {
          const isJobAborted = context.newFunction('__isAborted', (jobIdHandle: QuickJSHandle) => (
            host.isJobAborted!(String(context.dump(jobIdHandle))) ? context.true : context.false
          ));
          context.setProp(jobs, '__isAborted', isJobAborted);
          isJobAborted.dispose();
        }
        if (includeControl) {
          const nextJob = context.newFunction('__nextJob', () => createDeferredHostCall(
            host.waitForJobInvoke!(),
            (value) => (value === null ? context.null : newQuickJsJsonValue(context, value)),
          ));
          context.setProp(jobs, '__nextJob', nextJob);
          nextJob.dispose();
          const respondJob = context.newFunction('__respond', (jobIdHandle, completeHandle) => createDeferredHostCall(
            host.respondJobComplete!(
              String(context.dump(jobIdHandle)),
              context.dump(completeHandle) as PluginJobComplete,
            ),
            () => context.undefined,
          ));
          context.setProp(jobs, '__respond', respondJob);
          respondJob.dispose();
        }
        return jobs;
      };
      const jobs = createPluginJobsApi(undefined, true);
      context.setProp(serpent, 'jobs', jobs);
      jobs.dispose();

      // Captured by the domain API binding below. Scoped instances expose only
      // the public enqueue/report methods; job handlers remain registered on
      // the ambient instance and are therefore shared by all target scopes.
      scopedPluginJobsFactory = createPluginJobsApi;
    }
    if (host.waitForProviderInvoke !== undefined && host.respondProviderComplete !== undefined) {
      const providers = context.newObject();
      const nextProvider = context.newFunction('__nextInvoke', () => createDeferredHostCall(
        host.waitForProviderInvoke!(),
        (value) => (value === null ? context.null : newQuickJsJsonValue(context, value)),
      ));
      context.setProp(providers, '__nextInvoke', nextProvider);
      nextProvider.dispose();
      const respondProvider = context.newFunction('__respond', (invokeIdHandle, resultHandle) => createDeferredHostCall(
        host.respondProviderComplete!(
          String(context.dump(invokeIdHandle)),
          context.dump(resultHandle) as PluginProviderBatchResult,
        ),
        () => context.undefined,
      ));
      context.setProp(providers, '__respond', respondProvider);
      respondProvider.dispose();
      context.setProp(serpent, 'providers', providers);
      providers.dispose();
    }
    if (host.waitForSearchEvent !== undefined
      && host.respondSearchChunk !== undefined
      && host.respondSearchComplete !== undefined) {
      const providers = context.getProp(serpent, 'providers');
      try {
        const nextSearchEvent = context.newFunction('__nextSearchEvent', () => createDeferredHostCall(
          host.waitForSearchEvent!(),
          (value) => (value === null ? context.null : newQuickJsJsonValue(context, value)),
        ));
        context.setProp(providers, '__nextSearchEvent', nextSearchEvent);
        nextSearchEvent.dispose();
        const respondSearchChunk = context.newFunction('__respondSearchChunk', (chunkHandle) => createDeferredHostCall(
          host.respondSearchChunk!(
            context.dump(chunkHandle) as PluginSearchChunk,
          ),
          () => context.undefined,
        ));
        context.setProp(providers, '__respondSearchChunk', respondSearchChunk);
        respondSearchChunk.dispose();
        const respondSearchComplete = context.newFunction('__respondSearchComplete', (completeHandle) => createDeferredHostCall(
          host.respondSearchComplete!(
            context.dump(completeHandle) as PluginSearchComplete,
          ),
          () => context.undefined,
        ));
        context.setProp(providers, '__respondSearchComplete', respondSearchComplete);
        respondSearchComplete.dispose();
      } finally {
        providers.dispose();
      }
    }
    if (host.waitForCommandInvoke !== undefined && host.respondCommandComplete !== undefined) {
      const commands = context.newObject();
      const nextCommand = context.newFunction('__nextCommand', () => createDeferredHostCall(
        host.waitForCommandInvoke!(),
        (value) => (value === null ? context.null : newQuickJsJsonValue(context, value)),
      ));
      context.setProp(commands, '__nextCommand', nextCommand);
      nextCommand.dispose();
      const respondCommand = context.newFunction('__respond', (invokeIdHandle, completeHandle) => createDeferredHostCall(
        host.respondCommandComplete!(
          String(context.dump(invokeIdHandle)),
            context.dump(completeHandle) as PluginCommandComplete,
        ),
        () => context.undefined,
      ));
      context.setProp(commands, '__respond', respondCommand);
      respondCommand.dispose();
      context.setProp(serpent, 'commands', commands);
      commands.dispose();
    }
    if (host.executeStorageOperation !== undefined) {
      const storage = context.newObject();
      const get = context.newFunction('get', (keyHandle, optionsHandle) => {
        const options = optionsHandle === undefined ? undefined : context.dump(optionsHandle) as { scope?: 'library' | 'user' };
        const operation = 'get' as const;
        return createDeferredHostCall(
          host.executeStorageOperation!({
            operation,
            key: String(context.dump(keyHandle)),
            scope: options?.scope ?? 'library',
          }),
          (value) => newQuickJsJsonValue(context, projectPluginStorageResult(operation, value)),
        );
      });
      const set = context.newFunction('set', (keyHandle, valueHandle, optionsHandle) => {
        const options = optionsHandle === undefined ? undefined : context.dump(optionsHandle) as { scope?: 'library' | 'user' };
        const operation = 'set' as const;
        return createDeferredHostCall(
          host.executeStorageOperation!({
            operation,
            key: String(context.dump(keyHandle)),
            value: context.dump(valueHandle),
            scope: options?.scope ?? 'library',
          }),
          (value) => newQuickJsJsonValue(context, projectPluginStorageResult(operation, value)),
        );
      });
      const deleteKey = context.newFunction('delete', (keyHandle, optionsHandle) => {
        const options = optionsHandle === undefined ? undefined : context.dump(optionsHandle) as { scope?: 'library' | 'user' };
        const operation = 'delete' as const;
        return createDeferredHostCall(
          host.executeStorageOperation!({
            operation,
            key: String(context.dump(keyHandle)),
            scope: options?.scope ?? 'library',
          }),
          (value) => newQuickJsJsonValue(context, projectPluginStorageResult(operation, value)),
        );
      });
      const listKeys = context.newFunction('listKeys', (optionsHandle) => {
        const options = optionsHandle === undefined ? undefined : context.dump(optionsHandle) as { scope?: 'library' | 'user' };
        const operation = 'list' as const;
        return createDeferredHostCall(
          host.executeStorageOperation!({
            operation,
            scope: options?.scope ?? 'library',
          }),
          (value) => newQuickJsJsonValue(context, projectPluginStorageResult(operation, value)),
        );
      });
      context.setProp(storage, 'get', get);
      context.setProp(storage, 'set', set);
      context.setProp(storage, 'delete', deleteKey);
      context.setProp(storage, 'listKeys', listKeys);
      context.setProp(serpent, 'storage', storage);
      get.dispose();
      set.dispose();
      deleteKey.dispose();
      listKeys.dispose();
      storage.dispose();
      const data = context.newObject();
      const getDirectory = context.newFunction('getDirectory', (optionsHandle) => {
        const options = optionsHandle === undefined
          ? undefined
          : context.dump(optionsHandle) as { scope?: 'library' | 'user' };
        return createDeferredHostCall(
          host.executeStorageOperation!({
            operation: 'get-directory',
            ...(options?.scope === undefined ? {} : { scope: options.scope }),
          }),
          (value) => newQuickJsJsonValue(context, value),
        );
      });
      context.setProp(data, 'getDirectory', getDirectory);
      context.setProp(serpent, 'data', data);
      getDirectory.dispose();
      data.dispose();
    }
    if (
      host.requestInputCapture !== undefined
      && host.releaseInputCapture !== undefined
      && host.waitForInputCaptureEvent !== undefined
    ) {
      const input = context.newObject();
      const start = context.newFunction('__start', (optionsHandle) => createDeferredHostCall(
        host.requestInputCapture!(context.dump(optionsHandle) as PluginInputCaptureOptions),
        (value) => newQuickJsJsonValue(context, value),
      ));
      const release = context.newFunction('__release', (sessionIdHandle) => {
        host.releaseInputCapture!(String(context.dump(sessionIdHandle)));
        return context.undefined;
      });
      const nextEvent = context.newFunction('__nextEvent', (sessionIdHandle) => createDeferredHostCall(
        host.waitForInputCaptureEvent!(String(context.dump(sessionIdHandle))),
        (value) => (value === null ? context.null : newQuickJsJsonValue(context, value)),
      ));
      context.setProp(input, '__start', start);
      context.setProp(input, '__release', release);
      context.setProp(input, '__nextEvent', nextEvent);
      start.dispose();
      release.dispose();
      nextEvent.dispose();
      context.setProp(serpent, 'input', input);
      input.dispose();
    }
    if (host.executeAutomationCommand !== undefined) {
      const trash = context.newObject();
      const palettes = context.newObject();
      const ui = context.newObject();
      const jobs = context.newObject();
      const mediaJobs = context.newObject();
      const aiJobs = context.newObject();
      const createGuestCommandApi = (targetLibraryId?: string): QuickJSHandle => {
        const api = context.newObject();
        const namespaces = new Map<string, QuickJSHandle>();
        try {
          for (const definition of SERPENT_GUEST_COMMANDS) {
            const [namespace, method] = definition.path.split('.');
            if (namespace === undefined || method === undefined) {
              throw new Error(`Invalid Guest API command path: ${definition.path}`);
            }
            let target = namespaces.get(namespace);
            if (target === undefined) {
              target = context.newObject();
              namespaces.set(namespace, target);
              context.setProp(api, namespace, target);
            }
            const guestFunction = context.newFunction(method, (...argumentHandles: QuickJSHandle[]) => {
              const argumentsForHost = argumentHandles.map((argumentHandle) => context.dump(argumentHandle));
              return createDeferredHostCall(
                host.executeAutomationCommand!(
                  definition.commandId,
                  definition.buildInput(...argumentsForHost),
                  targetLibraryId === undefined ? undefined : { targetLibraryId },
                ),
                (value) => newQuickJsJsonValue(
                  context,
                  definition.projectResult?.(value) ?? value,
                ),
              );
            });
            context.setProp(target, method, guestFunction);
            guestFunction.dispose();
          }
          if (targetLibraryId !== undefined && scopedPluginJobsFactory !== undefined) {
            const scopedJobs = scopedPluginJobsFactory(targetLibraryId, false);
            context.setProp(api, 'jobs', scopedJobs);
            scopedJobs.dispose();
          }
          return api;
        } catch (error) {
          api.dispose();
          throw error;
        } finally {
          for (const namespace of namespaces.values()) namespace.dispose();
        }
      };
      // Script-only nested automation jobs stay Host-local: plugin jobs.* must not collide.
      const listMediaJobs = context.newFunction('list', (inputHandle) => createDeferredHostCall(
        host.executeAutomationCommand!(
          'media.jobs.list',
          inputHandle === undefined ? {} : context.dump(inputHandle),
        ),
        newQuickJsJsonValue.bind(undefined, context),
      ));
      const getAiJobStatus = context.newFunction('status', (inputHandle) => createDeferredHostCall(
        host.executeAutomationCommand!(
          'ai.jobs.status',
          inputHandle === undefined ? {} : context.dump(inputHandle),
        ),
        newQuickJsJsonValue.bind(undefined, context),
      ));
      const enqueueAi = context.newFunction('enqueue', (inputHandle) => createDeferredHostCall(
        host.executeAutomationCommand!(
          'ai.enqueue',
          inputHandle === undefined ? {} : context.dump(inputHandle),
        ),
        newQuickJsJsonValue.bind(undefined, context),
      ));
      const domainApi = createGuestCommandApi();
      for (const namespace of ['assets', 'library', 'folders', 'tags', 'collections', 'smartCollections', 'linkedFolders', 'files', 'trash', 'palettes', 'ui']) {
        const target = context.getProp(domainApi, namespace);
        try {
          context.setProp(serpent, namespace, target);
        } finally {
          target.dispose();
        }
      }
      const forLibrary = context.newFunction('forLibrary', (libraryIdHandle) => {
        const parsed = pluginTargetLibraryIdSchema.safeParse(context.dump(libraryIdHandle));
        if (!parsed.success || parsed.data === '__serpent_global_runtime__') {
          throw new Error('Invalid target library id.');
        }
        return createGuestCommandApi(parsed.data);
      });
      context.setProp(serpent, 'forLibrary', forLibrary);
      context.setProp(mediaJobs, 'list', listMediaJobs);
      context.setProp(aiJobs, 'status', getAiJobStatus);
      context.setProp(aiJobs, 'enqueue', enqueueAi);
      context.setProp(jobs, 'media', mediaJobs);
      context.setProp(jobs, 'ai', aiJobs);
      if (host.enqueuePluginJob === undefined) {
        context.setProp(serpent, 'jobs', jobs);
      }
      domainApi.dispose();
      jobs.dispose();
      mediaJobs.dispose();
      aiJobs.dispose();
      trash.dispose();
      palettes.dispose();
      ui.dispose();
      forLibrary.dispose();
      listMediaJobs.dispose();
      getAiJobStatus.dispose();
      enqueueAi.dispose();
    }
    context.setProp(consoleObject, 'log', log);
    context.setProp(context.global, 'serpent', serpent);
    context.setProp(context.global, 'console', consoleObject);
    serpent.dispose();
    consoleObject.dispose();
    log.dispose();

    const evaluation = context.evalCode(
      buildPromiseBudgetHarness(
        transpiledJavaScript,
        promiseTrackerIdentifier,
      ),
      'script.serpent.js',
      { type: 'global' },
    );
    if (evaluation.error) {
      const error = guestError(context, evaluation.error, cancellationRequested);
      evaluation.error.dispose();
      throw error;
    }

    const promiseHandle = evaluation.value;
    try {
      const result = await waitForGuestPromise(
        context,
        promiseHandle,
        runtime,
        startedAt + limits.wallTimeoutMs,
        () => cancellationRequested,
        limits.maxPendingJobBatches,
        disposeRetiredPromiseCallbacks,
      );
      const value = context.dump(result);
      const serialized = stringifyValue(value);
      result.dispose();
      if (serialized && utf8ByteLength(serialized) + outputBytes > limits.maxOutputBytes) {
        throw new QuickJsSandboxPrototypeError('OUTPUT_LIMIT', 'The script result exceeded its output limit.');
      }
      return { value, output, transpiledJavaScript };
    } finally {
      promiseHandle.dispose();
    }
  } finally {
    active = false;
    options?.signal?.removeEventListener('abort', abort);
    disposeDeferreds(deferreds);
    disposePromiseTracking();
    context.dispose();
    runtime.dispose();
  }
}
