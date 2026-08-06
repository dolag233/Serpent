import type { ModelThumbnailSourceAuthorization } from '../shared/model-thumbnail-protocol';

const entries = new Map<string, ModelThumbnailSourceAuthorization>();

function cacheKey(input: Pick<
  ModelThumbnailSourceAuthorization,
  'libraryId' | 'assetId' | 'revisionId'
>): string {
  return `${input.libraryId}\u0000${input.assetId}\u0000${input.revisionId}`;
}

/**
 * Register the Worker-authorized source scope for one active model render.
 * These paths stay in Main and are never included in the page render payload.
 */
export function registerModelThumbnailSourceAuthorizations(
  authorizations: readonly ModelThumbnailSourceAuthorization[],
): void {
  for (const authorization of authorizations) {
    entries.set(cacheKey(authorization), authorization);
  }
}

export function resolveModelThumbnailSourceAuthorization(input: {
  libraryId: string;
  assetId: string;
  revisionId: string;
}): ModelThumbnailSourceAuthorization | undefined {
  return entries.get(cacheKey(input));
}

export function clearModelThumbnailSourceAuthorizations(
  authorizations: readonly ModelThumbnailSourceAuthorization[],
): void {
  for (const authorization of authorizations) {
    const key = cacheKey(authorization);
    if (entries.get(key) === authorization) entries.delete(key);
  }
}

