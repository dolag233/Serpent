import { useEffect, useState, type ReactNode } from "react";

import type { SerpentPluginManagerApi } from "../shared/plugin-manager-api";
import type { PluginContributionContext } from "../plugins/plugin-context";
import {
  resolvePluginContributionConditions,
  runPluginMenuCommand,
} from "./plugin-menu-contributions";

export type PluginInspectorSectionDescriptor = {
  id: string;
  sectionLabel: string;
  actionLabel: string;
  contributionId: string;
  commandId: string;
  pluginId: string;
  disabled: boolean;
  when?: string;
  enablement?: string;
  checked?: string;
};

export function buildPluginInspectorSectionDescriptors(
  contributions: readonly {
    kind: 'inspector-section';
    id: string;
    title: string;
    commandTitle: string;
    commandId: string;
    pluginId: string;
    when?: string;
    enablement?: string;
    checked?: string;
  }[],
  context?: PluginContributionContext,
): PluginInspectorSectionDescriptor[] {
  return contributions
    .flatMap((contribution) => {
      const conditions = resolvePluginContributionConditions(contribution, context);
      if (!conditions.visible) return [];
      return [{
        id: contribution.id,
        sectionLabel: contribution.title,
        actionLabel: contribution.commandTitle,
        contributionId: contribution.id,
        commandId: contribution.commandId,
        pluginId: contribution.pluginId,
        ...(contribution.when === undefined ? {} : { when: contribution.when }),
        ...(contribution.enablement === undefined ? {} : { enablement: contribution.enablement }),
        ...(contribution.checked === undefined ? {} : { checked: contribution.checked }),
        disabled: conditions.disabled,
      }];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function usePluginInspectorSectionContributions(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
  context?: PluginContributionContext,
): PluginInspectorSectionDescriptor[] {
  const [items, setItems] = useState<PluginInspectorSectionDescriptor[]>([]);
  const shouldLoad = enabled && pluginApi !== undefined && libraryId !== undefined;

  useEffect(() => {
    if (!shouldLoad || pluginApi === undefined || libraryId === undefined) return;
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target: 'inspector.sections',
    }).then((result) => {
      if (cancelled) return;
      if (!("contributions" in result)) {
        setItems([]);
        return;
      }
      const sectionContributions = result.contributions.filter(
        (contribution): contribution is Extract<typeof contribution, { kind: 'inspector-section' }> => contribution.kind === 'inspector-section',
      );
      setItems(buildPluginInspectorSectionDescriptors(sectionContributions, context));
    }).catch((error: unknown) => {
      if (!cancelled) {
        setItems([]);
        console.warn("plugin-inspector-sections-unavailable", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [context, libraryId, pluginApi, refreshKey, shouldLoad]);

  return shouldLoad ? items : [];
}

export function PluginInspectorSections({
  pluginApi,
  libraryId,
  selectedAssetIds,
  disabled = false,
  refreshKey,
  context,
}: {
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
  selectedAssetIds: readonly string[];
  disabled?: boolean;
  refreshKey: string | null;
  context?: PluginContributionContext;
}): ReactNode {
  const items = usePluginInspectorSectionContributions(
    pluginApi,
    libraryId,
    pluginApi !== undefined && libraryId !== undefined && !disabled && selectedAssetIds.length > 0,
    refreshKey,
    context,
  );

  if (items.length === 0) return null;

  return (
    <>
      {items.map((item) => (
        <section className="inspector-section plugin-inspector-section" key={item.id}>
          <div className="plugin-inspector-section-header">
            <span className="inspector-section-label">{item.sectionLabel}</span>
            <button
              className="plugin-inspector-section-action"
              disabled={disabled || item.disabled}
              onClick={() => {
                if (pluginApi === undefined || libraryId === undefined) return;
                void runPluginMenuCommand(pluginApi, libraryId, item, {
                  assetIds: [...selectedAssetIds],
                });
              }}
              type="button"
            >
              {item.actionLabel}
            </button>
          </div>
        </section>
      ))}
    </>
  );
}
