import type { KeyboardEvent, ReactNode } from "react";

import {
  APP_SETTINGS_CATEGORIES,
  type AppSettingsCategoryId,
} from "./app-settings-sections";
import { Icon } from "./Icons";
import { useT } from "./i18n";

export type AppSettingsNavigationProps = {
  activeCategory: AppSettingsCategoryId;
  onSelect: (category: AppSettingsCategoryId) => void;
};

/** Keyboard-accessible category rail for the consolidated settings center. */
export function AppSettingsNavigation({
  activeCategory,
  onSelect,
}: AppSettingsNavigationProps): ReactNode {
  const t = useT();

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
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
    onSelect(next.id);
    document.getElementById(`app-settings-tab-${next.id}`)?.focus();
  }

  return (
    <nav aria-label={t("settings.categoriesLabel")} className="app-settings-nav">
      <div className="app-settings-nav-eyebrow">{t("settings.pageEyebrow")}</div>
      <div className="app-settings-nav-list" role="tablist">
        {APP_SETTINGS_CATEGORIES.map((category) => {
          const selected = category.id === activeCategory;
          return (
            <button
              aria-controls={`app-settings-page-${category.id}`}
              aria-selected={selected}
              className={`app-settings-nav-item${selected ? " is-active" : ""}`}
              id={`app-settings-tab-${category.id}`}
              key={category.id}
              onClick={() => onSelect(category.id)}
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
    </nav>
  );
}
