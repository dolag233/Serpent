import type { KeyboardEvent, ReactNode } from "react";
import { useState } from "react";

import {
  APP_SETTINGS_CATEGORIES,
  type AppSettingsCategoryId,
} from "./app-settings-sections";
import type { PluginSettingsNavEntry } from "./plugin-settings-detail";
import { Icon } from "./Icons";
import { useT } from "./i18n";

export type AppSettingsNavigationProps = {
  activeCategory: AppSettingsCategoryId | null;
  activePluginSettingsId: string | null;
  pluginSettingsEntries: readonly PluginSettingsNavEntry[];
  onSelectCategory: (category: AppSettingsCategoryId) => void;
  onSelectPluginSettings: (pluginId: string) => void;
};

/** Keyboard-accessible category rail for the consolidated settings center. */
export function AppSettingsNavigation({
  activeCategory,
  activePluginSettingsId,
  pluginSettingsEntries,
  onSelectCategory,
  onSelectPluginSettings,
}: AppSettingsNavigationProps): ReactNode {
  const t = useT();
  const [pluginSettingsExpanded, setPluginSettingsExpanded] = useState(
    () => activePluginSettingsId !== null,
  );

  const isPluginSettingsExpanded =
    pluginSettingsExpanded || activePluginSettingsId !== null;

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (activeCategory === null) return;
    const currentIndex = APP_SETTINGS_CATEGORIES.findIndex(
      (category) => category.id === activeCategory,
    );
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % APP_SETTINGS_CATEGORIES.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + APP_SETTINGS_CATEGORIES.length) %
        APP_SETTINGS_CATEGORIES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = APP_SETTINGS_CATEGORIES.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const next = APP_SETTINGS_CATEGORIES[nextIndex]!;
    onSelectCategory(next.id);
    document.getElementById(`app-settings-tab-${next.id}`)?.focus();
  }

  return (
    <nav aria-label={t("settings.categoriesLabel")} className="app-settings-nav">
      <div className="app-settings-nav-list" role="tablist">
        {APP_SETTINGS_CATEGORIES.map((category) => {
          const selected = activePluginSettingsId === null && category.id === activeCategory;
          return (
            <button
              aria-controls={`app-settings-page-${category.id}`}
              aria-selected={selected}
              className={`app-settings-nav-item${selected ? " is-active" : ""}`}
              id={`app-settings-tab-${category.id}`}
              key={category.id}
              onClick={() => onSelectCategory(category.id)}
              onKeyDown={handleKeyDown}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <Icon name={category.icon} size={16} />
              <span>{t(category.labelKey)}</span>
            </button>
          );
        })}
      </div>

      <div className="app-settings-nav-plugin-settings">
        <button
          aria-expanded={isPluginSettingsExpanded}
          className="app-settings-nav-item app-settings-nav-plugin-settings-toggle"
          onClick={() => setPluginSettingsExpanded((value) => !value)}
          type="button"
        >
          <Icon name="sliders" size={16} />
          <span>{t("settings.categoryPluginSettings")}</span>
          <span
            aria-hidden="true"
            className={`app-settings-nav-chevron${isPluginSettingsExpanded ? " is-expanded" : ""}`}
          >
            <Icon name="chevron-right" size={14} />
          </span>
        </button>
        {isPluginSettingsExpanded ? (
          <div className="app-settings-nav-plugin-settings-list" role="list">
            {pluginSettingsEntries.length === 0 ? (
              <p className="app-settings-nav-plugin-settings-empty">
                {t("settings.pluginSettingsNavEmpty")}
              </p>
            ) : (
              pluginSettingsEntries.map((entry) => {
                const selected = activePluginSettingsId === entry.pluginId;
                return (
                  <button
                    className={`app-settings-nav-item app-settings-nav-plugin-settings-item${selected ? " is-active" : ""}`}
                    key={entry.pluginId}
                    onClick={() => {
                      setPluginSettingsExpanded(true);
                      onSelectPluginSettings(entry.pluginId);
                    }}
                    role="listitem"
                    type="button"
                  >
                    <span>{entry.name}</span>
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
