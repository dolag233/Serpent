import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  PluginManagerViewerOverlayContribution,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import {
  buildPluginIframeViewDescriptors,
  PluginIframeViewHost,
  type PluginIframeViewDescriptor,
} from './plugin-iframe-view-host';
import { useT } from './i18n';
import { VIEWER_CHROME_TAB_INDEX } from './viewer-focus-policy';

export type PluginViewerOverlayDescriptor = PluginIframeViewDescriptor;

export function buildPluginViewerOverlayDescriptors(
  contributions: readonly PluginManagerViewerOverlayContribution[],
): PluginViewerOverlayDescriptor[] {
  return buildPluginIframeViewDescriptors(contributions);
}

export function usePluginViewerOverlays(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
): PluginViewerOverlayDescriptor[] {
  const [items, setItems] = useState<PluginViewerOverlayDescriptor[]>([]);
  const shouldLoad = enabled && pluginApi !== undefined && libraryId !== undefined;

  useEffect(() => {
    if (!shouldLoad || pluginApi === undefined || libraryId === undefined) return;
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target: 'viewer.overlays',
    }).then((result) => {
      if (cancelled || !('contributions' in result)) return;
      const views = result.contributions.filter(
        (contribution): contribution is PluginManagerViewerOverlayContribution =>
          contribution.kind === 'view' && contribution.target === 'viewer.overlays',
      );
      setItems(buildPluginViewerOverlayDescriptors(views));
    }).catch(() => {
      if (!cancelled) setItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [libraryId, pluginApi, refreshKey, shouldLoad]);

  return shouldLoad ? items : [];
}

export function PluginViewerOverlays({
  pluginApi,
  libraryId,
  disabled = false,
  refreshKey,
}: {
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
  disabled?: boolean;
  refreshKey: string | null;
}): ReactNode {
  const t = useT();
  const items = usePluginViewerOverlays(pluginApi, libraryId, !disabled, refreshKey);
  const [open, setOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(() => {
    const selectedId = items.some((item) => item.id === activeId) ? activeId : null;
    return items.find((item) => item.id === selectedId) ?? items[0];
  }, [activeId, items]);

  if (items.length === 0) return null;

  return (
    <div className="plugin-viewer-overlay-host">
      <button
        aria-expanded={open}
        aria-label={open ? t('preview.pluginOverlayHide') : t('preview.pluginOverlayShow')}
        className="plugin-viewer-overlay-toggle preview-chrome-fade"
        onClick={() => setOpen((current) => !current)}
        tabIndex={VIEWER_CHROME_TAB_INDEX}
        type="button"
      >
        {active?.title ?? t('preview.pluginOverlayShow')}
      </button>
      {open ? (
        <section
          aria-label={t('preview.pluginOverlayAriaLabel')}
          className="plugin-viewer-overlay-panel"
        >
          {items.length > 1 ? (
            <div className="plugin-viewer-overlay-tabs" role="tablist">
              {items.map((item) => (
                <button
                  aria-selected={item.id === active?.id}
                  className="compact-action"
                  key={item.id}
                  onClick={() => setActiveId(item.id)}
                  role="tab"
                  tabIndex={VIEWER_CHROME_TAB_INDEX}
                  type="button"
                >
                  {item.title}
                </button>
              ))}
            </div>
          ) : null}
          {active === undefined ? null : (
            <PluginIframeViewHost
              className="plugin-viewer-overlay-frame"
              libraryId={libraryId}
              pluginApi={pluginApi}
              view={active}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
