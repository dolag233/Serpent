export type ClassName = string | false | null | undefined;

/**
 * Joins optional semantic class names without introducing a styling dependency.
 * Keeping this tiny makes primitives usable by both the renderer and tests.
 */
export function cx(...classNames: ClassName[]): string | undefined {
  const value = classNames.filter((className): className is string => (
    typeof className === 'string' && className.length > 0
  )).join(' ');
  return value.length > 0 ? value : undefined;
}

export function mergeAriaDescribedBy(...ids: Array<string | undefined>): string | undefined {
  const value = ids.filter((id): id is string => id !== undefined && id.length > 0).join(' ');
  return value.length > 0 ? value : undefined;
}
