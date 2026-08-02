import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import type {
  PluginManagerPluginSettingSection,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import { useT } from './i18n';

type PluginHostSettingsFieldsProps = {
  readonly api: SerpentPluginManagerApi | undefined;
  readonly pluginId: string;
  readonly scope: 'user' | 'library';
  readonly libraryId: string | undefined;
  readonly disabled?: boolean;
};

export function PluginHostSettingsFields({
  api,
  pluginId,
  scope,
  libraryId,
  disabled = false,
}: PluginHostSettingsFieldsProps): ReactNode {
  const t = useT();
  const [sections, setSections] = useState<PluginManagerPluginSettingSection[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (api === undefined) return;
    if (scope === 'library' && libraryId === undefined) {
      setSections([]);
      return;
    }
    setLoading(true);
    try {
      const response = await api.request({
        type: 'plugin-manager.get-plugin-settings',
        pluginId,
        scope,
        ...(scope === 'library' && libraryId !== undefined ? { libraryId } : {}),
      });
      if (!response.ok || !('sections' in response)) {
        setError(t('settings.pluginOperationFailed', { code: response.ok ? 'unexpected-response' : response.code }));
        setSections([]);
        return;
      }
      setSections(response.sections);
      setError(undefined);
    } catch {
      setError(t('settings.pluginOperationFailed', { code: 'bridge-unavailable' }));
      setSections([]);
    } finally {
      setLoading(false);
    }
  }, [api, libraryId, pluginId, scope, t]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => void load(), 0);
    return () => globalThis.clearTimeout(timer);
  }, [load]);

  const save = useCallback(async (
    section: PluginManagerPluginSettingSection,
    value: boolean | number | string,
  ): Promise<void> => {
    if (api === undefined || disabled) return;
    if (scope === 'library' && libraryId === undefined) return;
    setSavingId(section.id);
    try {
      const response = await api.request({
        type: 'plugin-manager.set-plugin-setting',
        pluginId,
        scope,
        settingId: section.id,
        value,
        ...(scope === 'library' && libraryId !== undefined ? { libraryId } : {}),
      });
      if (!response.ok) {
        setError(t('settings.pluginOperationFailed', { code: response.code }));
        return;
      }
      setSections((current) => current.map((item) => (
        item.id === section.id ? { ...item, value } : item
      )));
      setError(undefined);
    } catch {
      setError(t('settings.pluginOperationFailed', { code: 'bridge-unavailable' }));
    } finally {
      setSavingId(undefined);
    }
  }, [api, disabled, libraryId, pluginId, scope, t]);

  if (loading) {
    return <p className="app-settings-hint">{t('settings.pluginSettingsLoading')}</p>;
  }
  if (sections.length === 0) return null;

  return (
    <div className="plugin-host-settings-fields">
      {error === undefined ? null : (
        <p className="plugin-settings-error" role="status">{error}</p>
      )}
      {sections.map((section) => {
        const fieldDisabled = disabled || savingId !== undefined;
        const descriptionId = section.description === undefined
          ? undefined
          : `plugin-setting-help-${section.id}`;
        const help = section.description === undefined ? null : (
          <span className="visually-hidden" id={descriptionId}>
            {section.description}
          </span>
        );
        if (section.type === 'boolean') {
          const checked = section.value === true;
          return (
            <label
              className="app-settings-toggle-row plugin-host-settings-field"
              data-hover-tip={section.description}
              key={section.id}
              title={section.description}
            >
              <span className="app-settings-row-copy">
                <strong>{section.title}</strong>
              </span>
              <span className="app-settings-toggle-control">
                <input
                  aria-label={section.title}
                  aria-describedby={descriptionId}
                  checked={checked}
                  disabled={fieldDisabled}
                  onChange={(event) => void save(section, event.target.checked)}
                  type="checkbox"
                />
                <span aria-hidden="true" className="app-settings-toggle-track" />
              </span>
              {help}
            </label>
          );
        }
        if (section.type === 'select') {
          const options = section.options ?? [];
          const selectValue = typeof section.value === 'string'
            && options.some((option) => option.value === section.value)
            ? section.value
            : (options[0]?.value ?? '');
          return (
            <label
              className="plugin-host-settings-field"
              data-hover-tip={section.description}
              key={section.id}
              title={section.description}
            >
              <span className="micro-label">{section.title}</span>
              <select
                aria-label={section.title}
                aria-describedby={descriptionId}
                className="text-field"
                disabled={fieldDisabled}
                onChange={(event) => void save(section, event.target.value)}
                value={selectValue}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {help}
            </label>
          );
        }
        if (section.type === 'number') {
          const numericValue = typeof section.value === 'number' ? section.value : '';
          return (
            <label
              className="plugin-host-settings-field"
              data-hover-tip={section.description}
              key={section.id}
              title={section.description}
            >
              <span className="micro-label">{section.title}</span>
              <input
                aria-describedby={descriptionId}
                className="text-field"
                disabled={fieldDisabled}
                onChange={(event) => {
                  const next = event.target.value.trim();
                  if (next === '') return;
                  const parsed = Number(next);
                  if (!Number.isFinite(parsed)) return;
                  void save(section, parsed);
                }}
                type="number"
                value={numericValue}
              />
              {help}
            </label>
          );
        }
        const textValue = typeof section.value === 'string' ? section.value : '';
        return (
          <label
            className="plugin-host-settings-field"
            data-hover-tip={section.description}
            key={section.id}
            title={section.description}
          >
            <span className="micro-label">{section.title}</span>
            <input
              aria-describedby={descriptionId}
              className="text-field"
              disabled={fieldDisabled}
              onBlur={(event) => void save(section, event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.currentTarget.blur();
              }}
              type="text"
              value={textValue}
              onChange={(event) => {
                const next = event.target.value;
                setSections((current) => current.map((item) => (
                  item.id === section.id ? { ...item, value: next } : item
                )));
              }}
            />
            {help}
          </label>
        );
      })}
    </div>
  );
}
