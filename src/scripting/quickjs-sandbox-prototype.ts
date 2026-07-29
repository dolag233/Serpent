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
  executeAutomationCommand?(commandId: AutomationScriptCommandId, input: unknown): Promise<unknown>;
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

/**
 * Project desktop asset summaries to the deliberately small Script API shape.
 * Paths, revision IDs, trash origins and thumbnail artifacts remain on the
 * trusted side of the bridge, while a script receives only the stable identity
 * and fields it needs for selection and automation.
 */
function scriptAssetPageResult(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) {
    return value;
  }
  const page = value as {
    items: unknown[];
    total?: unknown;
    offset?: unknown;
    limit?: unknown;
    hasMore?: unknown;
  };
  return {
    items: page.items.map((item) => {
    if (!item || typeof item !== 'object' || typeof (item as { assetId?: unknown }).assetId !== 'string') {
      return item;
    }
    const asset = item as Record<string, unknown> & { assetId: string };
    return {
      id: asset.assetId,
      name: typeof asset.displayName === 'string' ? asset.displayName : asset.assetId,
      rating: typeof asset.rating === 'number' ? asset.rating : 0,
      favorite: asset.favorite === true,
      locationKind: asset.locationKind === 'linked' ? 'linked' : 'managed',
      folderId: typeof asset.managedFolderId === 'string' ? asset.managedFolderId : null,
    };
    }),
    total: typeof page.total === 'number' ? page.total : page.items.length,
    offset: typeof page.offset === 'number' ? page.offset : 0,
    limit: typeof page.limit === 'number' ? page.limit : page.items.length,
    hasMore: page.hasMore === true,
  };
}

/** Folder paths are intentionally reduced to id/name relationships for scripts. */
function scriptFolderPageResult(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) {
    return value;
  }
  const page = value as {
    items: unknown[];
    total?: unknown;
    offset?: unknown;
    limit?: unknown;
    hasMore?: unknown;
  };
  return {
    items: page.items.map((item) => {
      if (!item || typeof item !== 'object' || typeof (item as { folderId?: unknown }).folderId !== 'string') {
        return item;
      }
      const folder = item as Record<string, unknown> & { folderId: string };
      return {
        id: folder.folderId,
        parentId: typeof folder.parentFolderId === 'string' ? folder.parentFolderId : null,
        name: typeof folder.name === 'string' ? folder.name : folder.folderId,
      };
    }),
    total: typeof page.total === 'number' ? page.total : page.items.length,
    offset: typeof page.offset === 'number' ? page.offset : 0,
    limit: typeof page.limit === 'number' ? page.limit : page.items.length,
    hasMore: page.hasMore === true,
  };
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
        () => {
          settleHostPromise(deferred, () => {
            const guestError = context.newError('The host request failed.');
            try {
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
    if (host.executeAutomationCommand !== undefined) {
      const assets = context.newObject();
      const folders = context.newObject();
      const listFolders = context.newFunction('list', (inputHandle) => createDeferredHostCall(
        host.executeAutomationCommand!(
          'folder.list',
          inputHandle === undefined ? {} : context.dump(inputHandle),
        ),
        (value) => newQuickJsJsonValue(context, scriptFolderPageResult(value)),
      ));
      const search = context.newFunction('search', (inputHandle) => createDeferredHostCall(
        host.executeAutomationCommand!('asset.search', context.dump(inputHandle)),
        (value) => newQuickJsJsonValue(context, scriptAssetPageResult(value)),
      ));
      const list = context.newFunction('list', (inputHandle) => createDeferredHostCall(
        host.executeAutomationCommand!('asset.list', inputHandle === undefined ? {} : context.dump(inputHandle)),
        (value) => newQuickJsJsonValue(context, scriptAssetPageResult(value)),
      ));
      const getMetadata = context.newFunction('getMetadata', (assetIdHandle) => createDeferredHostCall(
        host.executeAutomationCommand!('asset.metadata.get', {
          assetId: context.dump(assetIdHandle),
        }),
        newQuickJsJsonValue.bind(undefined, context),
      ));
      const setRating = context.newFunction('setRating', (assetIdsHandle, ratingHandle) => createDeferredHostCall(
        host.executeAutomationCommand!('asset.rating.set', {
          assetIds: context.dump(assetIdsHandle),
          rating: context.dump(ratingHandle),
        }),
        newQuickJsJsonValue.bind(undefined, context),
      ));
      const copyFilePaths = context.newFunction('copyFilePaths', (assetIdsHandle) => createDeferredHostCall(
        host.executeAutomationCommand!('asset.paths.copy', {
          assetIds: context.dump(assetIdsHandle),
        }),
        newQuickJsJsonValue.bind(undefined, context),
      ));
      const moveToTrash = context.newFunction('moveToTrash', (assetIdsHandle) => createDeferredHostCall(
        host.executeAutomationCommand!('asset.trash', {
          assetIds: context.dump(assetIdsHandle),
        }),
        newQuickJsJsonValue.bind(undefined, context),
      ));
      const renameFile = context.newFunction('renameFile', (assetIdHandle, newBaseNameHandle) => createDeferredHostCall(
        host.executeAutomationCommand!('asset.rename-file', {
          assetId: context.dump(assetIdHandle),
          newBaseName: context.dump(newBaseNameHandle),
        }),
        newQuickJsJsonValue.bind(undefined, context),
      ));
      const renameFiles = context.newFunction('renameFiles', (itemsHandle) => createDeferredHostCall(
        host.executeAutomationCommand!('asset.rename-files', {
          items: context.dump(itemsHandle),
        }),
        newQuickJsJsonValue.bind(undefined, context),
      ));
      const trash = context.newObject();
      const listTrash = context.newFunction('list', () => createDeferredHostCall(
        host.executeAutomationCommand!('asset.list-trash', {}),
        (value) => newQuickJsJsonValue(context, scriptAssetPageResult(value)),
      ));
      const restoreIfOriginalVacant = context.newFunction('restoreIfOriginalVacant', (assetIdsHandle) => createDeferredHostCall(
        host.executeAutomationCommand!('asset.restore-if-original-vacant', {
          assetIds: context.dump(assetIdsHandle),
        }),
        newQuickJsJsonValue.bind(undefined, context),
      ));
      const palettes = context.newObject();
      const mostFrequent = context.newFunction('mostFrequent', (inputHandle) => createDeferredHostCall(
        host.executeAutomationCommand!(
          'asset.palette.aggregate-recent',
          inputHandle === undefined ? {} : context.dump(inputHandle),
        ),
        newQuickJsJsonValue.bind(undefined, context),
      ));
      context.setProp(assets, 'search', search);
      context.setProp(assets, 'list', list);
      context.setProp(assets, 'getMetadata', getMetadata);
      context.setProp(assets, 'setRating', setRating);
      context.setProp(assets, 'copyFilePaths', copyFilePaths);
      context.setProp(assets, 'moveToTrash', moveToTrash);
      context.setProp(assets, 'renameFile', renameFile);
      context.setProp(assets, 'renameFiles', renameFiles);
      context.setProp(trash, 'list', listTrash);
      context.setProp(trash, 'restoreIfOriginalVacant', restoreIfOriginalVacant);
      context.setProp(palettes, 'mostFrequent', mostFrequent);
      context.setProp(folders, 'list', listFolders);
      context.setProp(serpent, 'assets', assets);
      context.setProp(serpent, 'folders', folders);
      context.setProp(serpent, 'trash', trash);
      context.setProp(serpent, 'palettes', palettes);
      assets.dispose();
      folders.dispose();
      trash.dispose();
      palettes.dispose();
      search.dispose();
      list.dispose();
      getMetadata.dispose();
      setRating.dispose();
      copyFilePaths.dispose();
      moveToTrash.dispose();
      renameFile.dispose();
      renameFiles.dispose();
      listTrash.dispose();
      restoreIfOriginalVacant.dispose();
      mostFrequent.dispose();
      listFolders.dispose();
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
