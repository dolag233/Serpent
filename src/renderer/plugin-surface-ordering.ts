/**
 * Stable ordering for command-backed surfaces that do not have menu placement
 * edges. Keeping this beside the menu placement code makes toolbar, Inspector,
 * Viewer and shortcut surfaces agree when registry responses arrive in a
 * different order.
 */
export type PluginSurfaceContributionIdentity = {
  id: string;
  pluginId: string;
  pluginInstanceId?: string;
};

export function sortPluginSurfaceContributions<
  T extends PluginSurfaceContributionIdentity,
>(contributions: readonly T[]): T[] {
  return contributions
    .map((contribution, sourceIndex) => ({ contribution, sourceIndex }))
    .sort((left, right) => (
      left.contribution.pluginId.localeCompare(right.contribution.pluginId)
      || (left.contribution.pluginInstanceId ?? "").localeCompare(
        right.contribution.pluginInstanceId ?? "",
      )
      || left.contribution.id.localeCompare(right.contribution.id)
      || left.sourceIndex - right.sourceIndex
    ))
    .map(({ contribution }) => contribution);
}
