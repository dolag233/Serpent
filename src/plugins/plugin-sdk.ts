import {
  PLUGIN_API_VERSION,
  PLUGIN_MANIFEST_VERSION,
  pluginContributesSchema,
  pluginManifestSchema,
  pluginPermissionSchema,
} from './plugin-manifest';
import { pluginContributionTargetSchema } from './plugin-contributions';

export { PLUGIN_API_VERSION, PLUGIN_MANIFEST_VERSION } from './plugin-manifest';

/**
 * Transport-safe contract used by the package manager, the future Plugin Host
 * and generated SDK distribution. It deliberately excludes internal IPC,
 * filesystem paths and database details.
 */
export function describePluginApi(): {
  apiVersion: typeof PLUGIN_API_VERSION;
  manifestVersion: typeof PLUGIN_MANIFEST_VERSION;
  manifestSchema: object;
  contributionSchema: object;
  permissions: readonly string[];
  contributionTargets: readonly string[];
} {
  return {
    apiVersion: PLUGIN_API_VERSION,
    manifestVersion: PLUGIN_MANIFEST_VERSION,
    manifestSchema: pluginManifestSchema.toJSONSchema(),
    contributionSchema: pluginContributesSchema.toJSONSchema(),
    permissions: pluginPermissionSchema.options,
    contributionTargets: pluginContributionTargetSchema.options,
  };
}

function unionLiteral(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(' | ');
}

/**
 * Generate a standalone declaration rather than importing host code into a
 * third-party package. Later SDK releases can add methods without exposing
 * Renderer, Main, Worker, Node or Zod implementation details.
 */
export function generatePluginSdkTypeDeclaration(_moduleSpecifier = '@serpent/plugin-api'): string {
  void _moduleSpecifier;
  const permissions = unionLiteral(pluginPermissionSchema.options);
  const targets = unionLiteral(pluginContributionTargetSchema.options);
  return [
    'export {};',
    '',
    'declare global {',
    `  type SerpentPluginPermission = ${permissions};`,
    `  type SerpentPluginContributionTarget = ${targets};`,
    '  type SerpentPluginDomainEventKind = \'library.changed\' | \'asset.changed\';',
    '  type SerpentPluginHookEvent = \'asset.trash\';',
    '  type SerpentPluginInputCaptureScope = \'application\' | \'viewer\' | \'view\';',
    '  type SerpentPluginInputCaptureEvent = Readonly<Record<string, unknown>> & { readonly type: string };',
    '  type SerpentPluginHookDecision =',
    '    | { readonly action: \'allow\' }',
    '    | { readonly action: \'warn\'; readonly message: string }',
    '    | { readonly action: \'block\'; readonly code: string; readonly message: string };',
    '',
    '  interface SerpentPluginContribution {',
    '    readonly id: string;',
    '    readonly target: SerpentPluginContributionTarget;',
    '    readonly title: string;',
    '  }',
    '',
    '  interface SerpentPluginDomainEvent {',
    '    readonly eventId: string;',
    '    readonly kind: SerpentPluginDomainEventKind;',
    '    readonly libraryId: string;',
    '    readonly occurredAt: string;',
    '    readonly causeChain: readonly string[];',
    '    readonly summary: Readonly<Record<string, unknown>>;',
    '  }',
    '',
    '  interface SerpentPluginHookContext {',
    '    readonly event: SerpentPluginHookEvent;',
    '    readonly libraryId: string;',
    '    readonly summary: Readonly<Record<string, unknown>>;',
    '    readonly causeChain: readonly string[];',
    '  }',
    '',
    '  interface SerpentPluginSearchRequest {',
    '    readonly query: unknown;',
    '    readonly filters?: readonly unknown[];',
    '    readonly scope?: unknown;',
    '    readonly sort?: unknown;',
    '    readonly scopeMode?: boolean;',
    '    readonly offset: number;',
    '    readonly limit: number;',
    '    readonly deadlineAt: number;',
    '    readonly maxResults: number;',
    '  }',
    '',
    '  interface SerpentPluginSearchResult {',
    '    readonly assetId: string;',
    '    readonly sortKey: string;',
    '    readonly score?: number;',
    '  }',
    '',
    '  interface SerpentPluginApi {',
    '    readonly apiVersion: 1;',
    '    readonly assets: {',
    '      search(input: { readonly query: string | null; readonly limit?: number; readonly offset?: number }): Promise<unknown>;',
    '      readContent(assetId: string, options?: { readonly maxBytes?: number }): Promise<{ readonly assetId: string; readonly revisionId: string; readonly byteSize: number; readonly dataBase64: string; readonly truncated: boolean; readonly mimeType: string | null }>;',
    '      replaceContent(assetId: string, dataBase64: string, options?: { readonly expectedRevisionId?: string; readonly mimeHint?: string }): Promise<{ readonly assetId: string; readonly revisionId: string; readonly byteSize: number }>;',
    '    };',
    '    readonly events: {',
    '      next(): Promise<SerpentPluginDomainEvent | null>;',
    '      on(kind: SerpentPluginDomainEventKind | \'*\', handler: (event: SerpentPluginDomainEvent) => void | Promise<void>): void;',
    '    };',
    '    readonly hooks: {',
    '      onWill(',
    '        event: SerpentPluginHookEvent,',
    '        handler: (context: SerpentPluginHookContext) => SerpentPluginHookDecision | Promise<SerpentPluginHookDecision>,',
    '      ): void;',
    '    };',
    '    readonly jobs: {',
    '      registerHandler(',
    '        handlerId: string,',
    '        handler: (payload: Readonly<Record<string, unknown>>, job: Readonly<Record<string, unknown>>) => void | Promise<void>,',
    '      ): void;',
    '      enqueue(input: {',
    '        readonly handlerId: string;',
    '        readonly payload?: Readonly<Record<string, unknown>>;',
    '        readonly recoveryStrategy?: \'idempotent\' | \'checkpoint\';',
    '      }): Promise<{ readonly jobId: string }>;',
    '    };',
    '    readonly providers: {',
    '      register(kind: \'preview\' | \'thumbnail\' | \'metadata\' | \'import\' | \'export\' | \'ai\' | \'derived-field\', provider: {',
    '        readonly id: string;',
    '        readonly compute: (batch: readonly unknown[], context: { readonly deadlineAt: number; readonly maxResults: number }) =>',
    '          readonly unknown[] | Promise<readonly unknown[]>;',
    '      }): void;',
    '      registerSearch(provider: { readonly id: string; readonly search: (request: SerpentPluginSearchRequest, signal: AbortSignal) => SerpentPluginSearchResult[] | AsyncIterable<SerpentPluginSearchResult> | Promise<SerpentPluginSearchResult[] | AsyncIterable<SerpentPluginSearchResult>> }): void;',
    '    };',
    '    readonly storage: {',
    '      get(key: string, options?: { readonly scope?: \'library\' | \'user\' }): Promise<unknown>;',
    '      set(key: string, value: unknown, options?: { readonly scope?: \'library\' | \'user\' }): Promise<void>;',
    '    };',
    '    readonly data: {',
    '      getDirectory(options?: { readonly scope?: \'library\' | \'user\' }): Promise<{ readonly path: string; readonly scope: \'library\' | \'user\' }>;',
    '    };',
    '    readonly commands: {',
    '      register(id: string, handler: (context: { readonly assetIds?: readonly string[] }) => void | Promise<void>): void;',
    '    };',
    '    readonly input: {',
    '      capture(options: {',
    '        readonly scope: SerpentPluginInputCaptureScope;',
    '        readonly keyboard?: boolean;',
    '        readonly pointer?: boolean;',
    '        readonly ownerViewId?: string;',
    '      }): Promise<{',
    '        readonly events: AsyncIterable<SerpentPluginInputCaptureEvent> & {',
    '          next(): Promise<IteratorResult<SerpentPluginInputCaptureEvent>>;',
    '        };',
    '        release(): void;',
    '      }>;',
    '    };',
    '    readonly contributions: {',
    '      registerContribution(contribution: SerpentPluginContribution): void;',
    '    };',
    '  }',
    '',
    '  const serpent: SerpentPluginApi;',
    '}',
    '',
  ].join('\n');
}
