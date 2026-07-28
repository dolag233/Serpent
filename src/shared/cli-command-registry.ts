import { z } from 'zod';

const libraryPathSchema = z.string().min(1);
const libraryIdSchema = z.string().min(1);
const librarySummarySchema = z.strictObject({
  libraryId: libraryIdSchema,
  displayName: z.string().min(1),
  libraryPath: libraryPathSchema,
});
const recordSchema = z.record(z.string(), z.unknown());

export const cliCommandInputSchemas = {
  version: z.strictObject({ json: z.boolean() }),
  commands: z.strictObject({ json: z.literal(true) }),
  health: z.strictObject({
    json: z.boolean(),
    libraryPath: libraryPathSchema.optional(),
  }),
  'library.inspect': z.strictObject({
    json: z.boolean(),
    libraryPath: libraryPathSchema,
  }),
  'folder.list': z.strictObject({
    json: z.boolean(),
    libraryPath: libraryPathSchema,
  }),
  'asset.list': z.strictObject({
    json: z.boolean(),
    libraryPath: libraryPathSchema,
    folderRef: z.string().min(1).optional(),
    recursive: z.boolean(),
  }),
  'tag.list': z.strictObject({
    json: z.boolean(),
    libraryPath: libraryPathSchema,
  }),
  'collection.list': z.strictObject({
    json: z.boolean(),
    libraryPath: libraryPathSchema,
  }),
  'smart-collection.list': z.strictObject({
    json: z.boolean(),
    libraryPath: libraryPathSchema,
  }),
  search: z.strictObject({
    json: z.boolean(),
    libraryPath: libraryPathSchema,
    query: z.string().max(1_000),
    limit: z.number().int().min(1).max(200),
    offset: z.number().int().min(0),
  }),
  'job.list': z.strictObject({
    json: z.boolean(),
    libraryPath: libraryPathSchema,
    kind: z.enum(['all', 'media', 'ai']),
  }),
} as const;

export type CliCommandId = keyof typeof cliCommandInputSchemas;

export interface CliCommandDescriptor {
  commandId: CliCommandId;
  summary: string;
  usage: string;
  mutatesLibrary: false;
  supportsDryRun: false;
  supportsDetach: false;
  requiredCapabilities: readonly string[];
  inputSchema: z.ZodType;
  resultSchema: z.ZodType;
}

const resultSchemas: Record<CliCommandId, z.ZodType> = {
  version: z.strictObject({ version: z.string().min(1) }),
  commands: z.strictObject({
    schemaVersion: z.number().int().positive(),
    commands: z.array(recordSchema),
  }),
  health: z.strictObject({
    status: z.literal('ok'),
    version: z.string().min(1),
    library: librarySummarySchema.optional(),
  }),
  'library.inspect': librarySummarySchema,
  'folder.list': z.strictObject({
    managed: z.array(recordSchema),
    linked: z.array(recordSchema),
  }),
  'asset.list': z.array(recordSchema),
  'tag.list': z.array(recordSchema),
  'collection.list': z.array(recordSchema),
  'smart-collection.list': z.array(recordSchema),
  search: z.strictObject({
    items: z.array(recordSchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    snippets: z.array(recordSchema).optional(),
  }),
  'job.list': z.union([recordSchema, z.array(recordSchema)]),
};

export const cliCommandRegistry = [
  ['version', '显示 Serpent CLI 版本。', 'serpent version [--json]', []],
  ['commands', '输出机器可读的命令契约。', 'serpent commands --json', []],
  ['health', '检查 CLI 运行状态，并可验证资源库。', 'serpent [--library <root>] health [--json]', []],
  ['library.inspect', '只读验证并显示资源库信息。', 'serpent --library <root> library inspect [--json]', ['library:read']],
  ['folder.list', '列出资源库文件夹。', 'serpent --library <root> folder list [--json]', ['library:read']],
  ['asset.list', '列出资产。', 'serpent --library <root> asset list [--folder <id|/path>] [--recursive] [--json]', ['library:read']],
  ['tag.list', '列出标签。', 'serpent --library <root> tag list [--json]', ['library:read']],
  ['collection.list', '列出合集。', 'serpent --library <root> collection list [--json]', ['library:read']],
  ['smart-collection.list', '列出智能合集。', 'serpent --library <root> smart-collection list [--json]', ['library:read']],
  ['search', '搜索当前资源库资产。', 'serpent --library <root> search <expression> [--limit <n>] [--offset <n>] [--json]', ['library:read']],
  ['job.list', '查询媒体和 AI 后台任务。', 'serpent --library <root> job list [--kind all|media|ai] [--json]', ['library:read']],
] satisfies ReadonlyArray<readonly [
  CliCommandId,
  string,
  string,
  readonly string[],
]>;

export const cliCommandDescriptors: readonly CliCommandDescriptor[] =
  cliCommandRegistry.map(([commandId, summary, usage, requiredCapabilities]) => ({
    commandId,
    summary,
    usage,
    mutatesLibrary: false,
    supportsDryRun: false,
    supportsDetach: false,
    requiredCapabilities,
    inputSchema: cliCommandInputSchemas[commandId],
    resultSchema: resultSchemas[commandId],
  }));

export function describeCliCommands(): unknown {
  return {
    schemaVersion: 1,
    commands: cliCommandDescriptors.map((descriptor) => ({
      commandId: descriptor.commandId,
      summary: descriptor.summary,
      usage: descriptor.usage,
      mutatesLibrary: descriptor.mutatesLibrary,
      supportsDryRun: descriptor.supportsDryRun,
      supportsDetach: descriptor.supportsDetach,
      requiredCapabilities: descriptor.requiredCapabilities,
      inputSchema: descriptor.inputSchema.toJSONSchema(),
      resultSchema: descriptor.resultSchema.toJSONSchema(),
    })),
  };
}
