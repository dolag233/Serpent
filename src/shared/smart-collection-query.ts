/**
 * CU-M5: a smart collection must encode a real discovery constraint.
 * Sort-only (or empty `{}`) definitions match every asset and are rejected.
 *
 * Accepts a structural subset so Renderer `SearchDefinition` (looser field
 * typing) and Zod `SmartCollectionQueryDefinition` can share one check.
 */
export function hasMeaningfulSmartCollectionCondition(definition: {
  search?: { clauses?: readonly unknown[] } | null;
  filters?: readonly unknown[] | null;
  sort?: unknown;
}): boolean {
  const searchClauses = definition.search?.clauses ?? [];
  const filters = definition.filters ?? [];
  return searchClauses.length > 0 || filters.length > 0;
}
