import { automationScriptAssetSearchInputSchema } from '../shared/automation-script-api';
import { parseSearchExpression } from '../shared/search-expression';

/**
 * Scripts and Standard Host guests pass toolbar-style `{ query: string|null }`.
 * The Automation Gateway expects the same structured SearchQuery AST as Worker.
 * Returns undefined when the payload is neither script-shaped nor already valid
 * enough to forward (caller maps that to an invalid-search failure).
 */
export function normalizeAutomationAssetSearchInput(rawInput: unknown): unknown | undefined {
  const search = automationScriptAssetSearchInputSchema.safeParse(rawInput);
  if (!search.success) return undefined;
  return {
    ...search.data,
    query: search.data.query === null ? null : parseSearchExpression(search.data.query),
  };
}
