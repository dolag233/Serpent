import { z } from 'zod';

const boundedId = z.string().min(1).max(255);
const boundedText = z.string().max(512);
const boundedList = <T extends z.ZodType>(item: T, max = 256) => z.array(item).max(max);

const selectionSummarySchema = z.strictObject({
  managedCount: z.number().int().nonnegative(),
  unmanagedCount: z.number().int().nonnegative(),
  availableCount: z.number().int().nonnegative(),
  unavailableCount: z.number().int().nonnegative(),
  deletedCount: z.number().int().nonnegative(),
  hasDeleted: z.boolean(),
  hasUnavailable: z.boolean(),
});

export const pluginContributionContextSchema = z.strictObject({
  contextId: boundedId,
  revision: z.number().int().positive(),
  app: z.strictObject({
    platform: z.string().min(1).max(32),
    locale: z.string().min(1).max(32),
    theme: z.enum(['light', 'dark', 'system']),
    busy: z.boolean(),
  }),
  surface: z.strictObject({
    id: boundedId,
    kind: z.string().min(1).max(64),
  }),
  window: z.strictObject({
    windowId: boundedId,
  }),
  library: z.strictObject({
    id: boundedId.optional(),
    open: z.boolean(),
    writable: z.boolean(),
    offline: z.boolean(),
  }),
  selection: z.strictObject({
    ref: boundedId.optional(),
    count: z.number().int().nonnegative().max(1_000_000),
    primaryId: boundedId.optional(),
    assetCount: z.number().int().nonnegative().max(1_000_000),
    folderCount: z.number().int().nonnegative().max(1_000_000),
    mixed: z.boolean(),
    extensions: boundedList(z.string().min(1).max(32).transform((value) => value.toLowerCase()), 256),
    mimeTypes: boundedList(z.string().min(1).max(128), 256),
    mediaKinds: boundedList(z.string().min(1).max(64), 64),
    summary: selectionSummarySchema,
    hasDeleted: z.boolean(),
    hasUnavailable: z.boolean(),
  }),
  browse: z.strictObject({
    folderId: boundedId.optional(),
    collectionId: boundedId.optional(),
    tagId: boundedId.optional(),
    search: boundedText.optional(),
    filter: boundedText.optional(),
  }),
  viewer: z.strictObject({
    active: z.boolean(),
    assetId: boundedId.optional(),
    extension: z.string().min(1).max(32).optional(),
    mimeType: z.string().min(1).max(128).optional(),
    mediaKind: z.string().min(1).max(64).optional(),
    fullscreen: z.boolean(),
  }),
});

export type PluginContributionContext = z.infer<typeof pluginContributionContextSchema>;

export const pluginInvocationContextSchema = z.strictObject({
  contextId: boundedId,
  revision: z.number().int().positive(),
  libraryId: boundedId,
  selection: z.strictObject({
    ref: boundedId.optional(),
    refs: boundedList(boundedId, 10_000),
    assetIds: boundedList(boundedId, 10_000),
    folderIds: boundedList(boundedId, 10_000),
    collectionIds: boundedList(boundedId, 10_000),
  }),
  browse: z.strictObject({
    folderId: boundedId.optional(),
    collectionId: boundedId.optional(),
    tagId: boundedId.optional(),
    search: boundedText.optional(),
    filter: boundedText.optional(),
  }),
  viewer: z.strictObject({
    active: z.boolean(),
    assetId: boundedId.optional(),
  }),
});

export type PluginInvocationContext = z.infer<typeof pluginInvocationContextSchema>;

export type PluginInvocationTarget = {
  libraryId?: string;
  selection?: {
    ref?: string;
    refs?: readonly string[];
    assetIds?: readonly string[];
  folderIds?: readonly string[];
  collectionIds?: readonly string[];
  };
};

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    const cloned = value.map((item) => cloneAndFreeze(item));
    return Object.freeze(cloned) as T;
  }
  if (value !== null && typeof value === 'object') {
    const cloned = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneAndFreeze(item)]),
    );
    return Object.freeze(cloned) as T;
  }
  return value;
}

export function createPluginContributionContext(
  input: z.input<typeof pluginContributionContextSchema>,
): PluginContributionContext {
  return cloneAndFreeze(pluginContributionContextSchema.parse(input));
}

export function createPluginInvocationContext(
  context: PluginContributionContext,
  target?: PluginInvocationTarget,
): PluginInvocationContext {
  const parsed = pluginContributionContextSchema.parse(context);
  const selection = target?.selection;
  const libraryId = target?.libraryId ?? parsed.library.id;
  if (libraryId === undefined) {
    throw new Error('An invocation context requires an open library.');
  }
  const invocation = pluginInvocationContextSchema.parse({
    contextId: parsed.contextId,
    revision: parsed.revision,
    libraryId,
    selection: {
      ref: selection?.ref ?? parsed.selection.ref,
      refs: [...(selection?.refs ?? [])],
      assetIds: [...(selection?.assetIds ?? [])],
    folderIds: [...(selection?.folderIds ?? [])],
      collectionIds: [...(selection?.collectionIds ?? [])],
    },
    browse: parsed.browse,
    viewer: {
      active: parsed.viewer.active,
      ...(parsed.viewer.assetId === undefined ? {} : { assetId: parsed.viewer.assetId }),
    },
  });
  return cloneAndFreeze(invocation);
}

export class PluginContextPublisher {
  #current: PluginContributionContext | undefined;

  constructor(initial?: PluginContributionContext) {
    this.#current = initial === undefined ? undefined : createPluginContributionContext(initial);
  }

  publish(next: PluginContributionContext): PluginContributionContext {
    const context = createPluginContributionContext(next);
    if (this.#current !== undefined) {
      if (context.contextId !== this.#current.contextId) {
        throw new Error('Context ID cannot change within a context publisher.');
      }
      if (context.revision <= this.#current.revision) {
        throw new Error('Context revision must increase monotonically.');
      }
    }
    this.#current = context;
    return context;
  }

  get current(): PluginContributionContext | undefined {
    return this.#current;
  }
}

type UnknownValue = { readonly __unknown: unique symbol };
const UNKNOWN = {} as UnknownValue;
const isUnknown = (value: ParsedValue | UnknownValue): value is UnknownValue => value === UNKNOWN;

type Token =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'identifier'; value: string }
  | { kind: 'operator'; value: '&&' | '||' | '!' | '==' | '!=' | 'in' | 'intersects' | 'matches' }
  | { kind: 'punctuation'; value: '(' | ')' | '[' | ']' | ',' };

const expressionLengthLimit = 4_096;
const tokenLimit = 512;

function tokenize(expression: string): Token[] | undefined {
  if (expression.length > expressionLengthLimit) return undefined;
  const tokens: Token[] = [];
  let index = 0;
  const push = (token: Token): boolean => {
    tokens.push(token);
    return tokens.length <= tokenLimit;
  };
  while (index < expression.length) {
    const char = expression[index];
    if (char === undefined) break;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (expression.startsWith('&&', index) || expression.startsWith('||', index)
      || expression.startsWith('==', index) || expression.startsWith('!=', index)) {
      const value = expression.slice(index, index + 2) as '&&' | '||' | '==' | '!=';
      if (!push({ kind: 'operator', value })) return undefined;
      index += 2;
      continue;
    }
    if ('!(),[]'.includes(char)) {
      if (char === '!') {
        if (!push({ kind: 'operator', value: '!' })) return undefined;
      } else if (!push({ kind: 'punctuation', value: char as '(' | ')' | ',' | '[' | ']' })) return undefined;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      let value = '';
      index += 1;
      let closed = false;
      while (index < expression.length) {
        const current = expression[index];
        if (current === undefined) break;
        if (current === '\\') {
          const escaped = expression[index + 1];
          if (escaped === undefined) return undefined;
          value += escaped;
          index += 2;
        } else if (current === quote) {
          closed = true;
          index += 1;
          break;
        } else {
          value += current;
          index += 1;
        }
      }
      if (!closed || !push({ kind: 'literal', value })) return undefined;
      continue;
    }
    const number = expression.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?/u);
    if (number !== null) {
      if (!push({ kind: 'literal', value: Number(number[0]) })) return undefined;
      index += number[0].length;
      continue;
    }
    const identifier = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_.-]*/u);
    if (identifier !== null) {
      const value = identifier[0];
      if (value === 'true' || value === 'false') {
        if (!push({ kind: 'literal', value: value === 'true' })) return undefined;
      } else if (value === 'null') {
        if (!push({ kind: 'literal', value: null })) return undefined;
      } else if (value === 'in' || value === 'intersects' || value === 'matches') {
        if (!push({ kind: 'operator', value })) return undefined;
      } else if (!push({ kind: 'identifier', value })) return undefined;
      index += value.length;
      continue;
    }
    return undefined;
  }
  return tokens;
}

type ParsedValue = string | number | boolean | null | UnknownValue | ParsedValue[];

function parseExpressionValue(tokens: readonly Token[], context: Record<string, unknown>): boolean {
  let cursor = 0;
  let depth = 0;
  const peek = (): Token | undefined => tokens[cursor];
  const consume = (): Token | undefined => {
    const token = tokens[cursor];
    cursor += 1;
    return token;
  };
  const readPath = (path: string): ParsedValue => {
    let value: unknown = context;
    for (const segment of path.split('.')) {
      if (value === null || typeof value !== 'object' || !(segment in value)) return UNKNOWN;
      value = (value as Record<string, unknown>)[segment];
    }
    if (Array.isArray(value)) return value.map((item) => item as ParsedValue);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      return value;
    }
    return UNKNOWN;
  };
  const parseValue = (): ParsedValue => {
    const token = consume();
    if (token === undefined) return UNKNOWN;
    if (token.kind === 'literal') return token.value;
    if (token.kind === 'identifier') return readPath(token.value);
    if (token.kind !== 'punctuation' || token.value !== '[') return UNKNOWN;
    if (depth++ > 32) return UNKNOWN;
    const values: ParsedValue[] = [];
    if (peek()?.kind === 'punctuation' && peek()?.value === ']') {
      consume();
      depth -= 1;
      return values;
    }
    while (true) {
      values.push(parseValue());
      const separator = consume();
      if (separator?.kind === 'punctuation' && separator.value === ']') break;
      if (separator?.kind !== 'punctuation' || separator.value !== ',') return UNKNOWN;
    }
    depth -= 1;
    return values;
  };
  const parsePrimary = (): ParsedValue => {
    if (peek()?.kind === 'punctuation' && peek()?.value === '(') {
      consume();
      const value = parseOr();
      const close = consume();
      return close?.kind === 'punctuation' && close.value === ')' ? value : UNKNOWN;
    }
    return parseValue();
  };
  const parseUnary = (): ParsedValue => {
    if (peek()?.kind === 'operator' && peek()?.value === '!') {
      consume();
      const value = parseUnary();
      return value === UNKNOWN ? UNKNOWN : !value;
    }
    return parsePrimary();
  };
  const equal = (left: ParsedValue, right: ParsedValue): boolean | UnknownValue => {
    if (left === UNKNOWN || right === UNKNOWN) return UNKNOWN;
    if (Array.isArray(left) || Array.isArray(right)) return JSON.stringify(left) === JSON.stringify(right);
    return left === right;
  };
  const asArray = (value: ParsedValue): ParsedValue[] | UnknownValue => {
    if (isUnknown(value)) return UNKNOWN;
    return Array.isArray(value) ? value : [value];
  };
  const globMatch = (value: string, pattern: string): boolean => {
    if (pattern.length > 256) return false;
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
      const end = pattern.lastIndexOf('/');
      try {
        return new RegExp(pattern.slice(1, end), pattern.slice(end + 1)).test(value);
      } catch {
        return false;
      }
    }
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*').replace(/\?/gu, '.');
    if (pattern.startsWith('*.') && !value.includes('.')) {
      return pattern.slice(2) === value;
    }
    return new RegExp(`^${escaped}$`, 'u').test(value);
  };
  const applyComparison = (left: ParsedValue, operator: Token, right: ParsedValue): ParsedValue => {
    if (operator.kind !== 'operator') return UNKNOWN;
    if (operator.value === '==' || operator.value === '!=') {
      const result = equal(left, right);
      return result === UNKNOWN ? UNKNOWN : operator.value === '==' ? result : !result;
    }
    if (operator.value === 'in') {
      const values = asArray(right);
      if (isUnknown(values)) return UNKNOWN;
      return values.some((item) => equal(left, item) === true);
    }
    if (operator.value === 'intersects') {
      const leftValues = asArray(left);
      const rightValues = asArray(right);
      if (isUnknown(leftValues) || isUnknown(rightValues)) return UNKNOWN;
      return leftValues.some((leftItem) => rightValues.some((rightItem) => equal(leftItem, rightItem) === true));
    }
    if (operator.value === 'matches') {
      const leftValues = asArray(left);
      const rightValues = asArray(right);
      if (isUnknown(leftValues) || isUnknown(rightValues)) return UNKNOWN;
      const patterns = rightValues.filter((item): item is string => typeof item === 'string');
      if (patterns.length !== rightValues.length) return false;
      return leftValues.some((item) => typeof item === 'string' && patterns.some((pattern) => globMatch(item, pattern)));
    }
    return UNKNOWN;
  };
  const parseComparison = (): ParsedValue => {
    const left = parseUnary();
    const operator = peek();
    if (operator?.kind !== 'operator' || !['==', '!=', 'in', 'intersects', 'matches'].includes(operator.value)) return left;
    consume();
    return applyComparison(left, operator, parseUnary());
  };
  const parseAnd = (): ParsedValue => {
    let value = parseComparison();
    while (peek()?.kind === 'operator' && peek()?.value === '&&') {
      consume();
      const right = parseComparison();
      value = value === UNKNOWN || right === UNKNOWN ? UNKNOWN : Boolean(value) && Boolean(right);
    }
    return value;
  };
  const parseOr = (): ParsedValue => {
    let value = parseAnd();
    while (peek()?.kind === 'operator' && peek()?.value === '||') {
      consume();
      const right = parseAnd();
      value = value === UNKNOWN || right === UNKNOWN ? UNKNOWN : Boolean(value) || Boolean(right);
    }
    return value;
  };
  const result = parseOr();
  return cursor === tokens.length && result !== UNKNOWN && Boolean(result);
}

export function evaluatePluginContextExpression(
  expression: string,
  context: PluginContributionContext | Record<string, unknown>,
): boolean {
  try {
    const tokens = tokenize(expression);
    return tokens === undefined || tokens.length === 0 ? false : parseExpressionValue(tokens, context);
  } catch {
    return false;
  }
}

export type PluginPredicateResolver = (
  context: PluginContributionContext,
  signal: AbortSignal,
) => boolean | Promise<boolean>;

export type PredicateResolverRequest = {
  pluginInstanceId: string;
  predicateId: string;
  context: PluginContributionContext;
  resolver: PluginPredicateResolver;
  fallback?: boolean;
  deadlineMs?: number;
};

type PredicateEntry = {
  key: string;
  pluginInstanceId: string;
  contextId: string;
  revision: number;
  predicateId: string;
  status: 'pending' | 'resolved';
  value: boolean;
};

export function createPluginPredicateCacheKey(
  input: Pick<PredicateResolverRequest, 'pluginInstanceId' | 'predicateId' | 'context'>,
): string {
  return `${input.pluginInstanceId}\u0000${input.context.contextId}\u0000${input.context.revision}\u0000${input.predicateId}`;
}

export class PluginPredicateResolverCache {
  readonly #entries = new Map<string, PredicateEntry>();
  readonly #controllers = new Map<string, { revision: number; controller: AbortController }>();
  readonly #defaultDeadlineMs: number;

  constructor(options?: { defaultDeadlineMs?: number }) {
    this.#defaultDeadlineMs = Math.max(1, Math.min(options?.defaultDeadlineMs ?? 2_000, 60_000));
  }

  start(input: PredicateResolverRequest): void {
    const key = createPluginPredicateCacheKey(input);
    const scopeKey = `${input.pluginInstanceId}\u0000${input.context.contextId}`;
    const previous = this.#controllers.get(scopeKey);
    if (previous !== undefined && input.context.revision > previous.revision) {
      previous.controller.abort(new Error('Context revision superseded.'));
    }
    const controller = new AbortController();
    this.#controllers.set(scopeKey, { revision: input.context.revision, controller });
    const fallback = input.fallback ?? false;
    this.#entries.set(key, {
      key,
      pluginInstanceId: input.pluginInstanceId,
      contextId: input.context.contextId,
      revision: input.context.revision,
      predicateId: input.predicateId,
      status: 'pending',
      value: fallback,
    });
    void this.#run(input, key, scopeKey, controller, fallback);
  }

  async resolve(input: PredicateResolverRequest): Promise<boolean> {
    const key = createPluginPredicateCacheKey(input);
    const fallback = input.fallback ?? false;
    if (!this.#entries.has(key)) this.start(input);
    while (true) {
      const entry = this.#entries.get(key);
      if (entry?.status === 'resolved') return entry.value;
      // A newer context revision removes a superseded pending entry. Do not
      // leave a caller waiting forever for a value that is intentionally no
      // longer valid; the caller can re-resolve against the new context.
      if (entry === undefined) return fallback;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  read(input: Pick<PredicateResolverRequest, 'pluginInstanceId' | 'predicateId' | 'context'>): boolean | undefined {
    const entry = this.#entries.get(createPluginPredicateCacheKey(input));
    return entry?.status === 'resolved' ? entry.value : undefined;
  }

  get = this.read.bind(this);

  readWithFallback(
    input: Pick<PredicateResolverRequest, 'pluginInstanceId' | 'predicateId' | 'context'>,
    fallback = false,
  ): boolean {
    return this.read(input) ?? fallback;
  }

  async #run(
    input: PredicateResolverRequest,
    key: string,
    scopeKey: string,
    controller: AbortController,
    fallback: boolean,
  ): Promise<void> {
    const deadlineMs = Math.max(1, Math.min(input.deadlineMs ?? this.#defaultDeadlineMs, 60_000));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => input.resolver(input.context, controller.signal)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(new Error('Predicate resolver deadline exceeded.'));
            reject(new Error('Predicate resolver deadline exceeded.'));
          }, deadlineMs);
        }),
      ]);
      const entry = this.#entries.get(key);
      if (entry !== undefined) {
        if (controller.signal.aborted) {
          // A resolver may ignore the AbortSignal and settle after its
          // revision was superseded. Never leave that stale entry pending.
          this.#entries.delete(key);
        } else {
          entry.status = 'resolved';
          entry.value = result === true;
        }
      }
    } catch {
      const entry = this.#entries.get(key);
      const superseded = controller.signal.reason instanceof Error
        && controller.signal.reason.message === 'Context revision superseded.';
      if (superseded) {
        this.#entries.delete(key);
      } else if (entry !== undefined) {
        entry.status = 'resolved';
        entry.value = fallback;
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      const current = this.#controllers.get(scopeKey);
      if (current?.controller === controller) this.#controllers.delete(scopeKey);
    }
  }
}

export function createPluginPredicateResolverCache(options?: { defaultDeadlineMs?: number }): PluginPredicateResolverCache {
  return new PluginPredicateResolverCache(options);
}
