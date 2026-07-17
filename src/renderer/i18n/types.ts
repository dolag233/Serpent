// ---------------------------------------------------------------------------
// Renderer i18n core (REQ-I18N-001 / REQ-I18N-002)
//
// UI copy lives in typed message catalogs. Machine-facing logs and protocol
// error codes stay in English / stable codes outside this module.
// ---------------------------------------------------------------------------

export type AppLocale = 'zh-CN' | 'en';

/** Nested message tree; leaf values are display strings. */
export type MessageTree = {
  readonly [key: string]: string | MessageTree;
};

export type TranslateParams = Readonly<Record<string, string | number>>;

/**
 * Flatten nested keys: `{ a: { b: 'x' } }` → `'a.b'`.
 * Used for typed catalog lookup without a codegen step.
 */
export type FlattenMessageKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? Prefix extends ''
      ? K
      : `${Prefix}.${K}`
    : T[K] extends MessageTree
      ? FlattenMessageKeys<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>
      : never;
}[keyof T & string];

export function lookupMessage(
  tree: MessageTree,
  key: string,
): string | undefined {
  const parts = key.split('.');
  let node: string | MessageTree | undefined = tree;
  for (const part of parts) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Replace `{name}` placeholders. Unknown placeholders are left intact so
 * missing params surface during review instead of silently vanishing.
 */
export function interpolate(
  template: string,
  params?: TranslateParams,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function createTranslator(
  messages: MessageTree,
  fallbackMessages?: MessageTree,
): (key: string, params?: TranslateParams) => string {
  return (key, params) => {
    const primary = lookupMessage(messages, key);
    const fallback = fallbackMessages
      ? lookupMessage(fallbackMessages, key)
      : undefined;
    const template = primary ?? fallback ?? key;
    return interpolate(template, params);
  };
}
