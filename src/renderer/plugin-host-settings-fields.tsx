import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import type {
  PluginManagerPluginSettingDiagnostic,
  PluginManagerPluginSettingSection,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import { useT } from './i18n';
import {
  Field,
  getFieldAriaProps,
  getFieldIds,
  Select,
  Slider,
  Switch,
  TextField,
  Tooltip,
} from './ui/primitives';

type PluginHostSettingsFieldsProps = {
  readonly api: SerpentPluginManagerApi | undefined;
  readonly pluginId: string;
  readonly scope: 'user' | 'library';
  readonly libraryId: string | undefined;
  readonly disabled?: boolean;
};

export function resolvePluginSettingSelectValue(
  section: Pick<PluginManagerPluginSettingSection, 'value' | 'default' | 'options'>,
): string {
  const options = section.options ?? [];
  const isOptionValue = (value: unknown): value is string => (
    typeof value === 'string' && options.some((option) => option.value === value)
  );
  if (isOptionValue(section.value)) return section.value;
  if (isOptionValue(section.default)) return section.default;
  return options[0]?.value ?? '';
}

export function PluginHostSettingsFields({
  api,
  pluginId,
  scope,
  libraryId,
  disabled = false,
}: PluginHostSettingsFieldsProps): ReactNode {
  const t = useT();
  const [sections, setSections] = useState<PluginManagerPluginSettingSection[]>([]);
  const [diagnostics, setDiagnostics] = useState<PluginManagerPluginSettingDiagnostic[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (api === undefined) return;
    if (scope === 'library' && libraryId === undefined) {
      setSections([]);
      setDiagnostics([]);
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
        setDiagnostics([]);
        return;
      }
      setSections(response.sections);
      setDiagnostics(response.diagnostics);
      setError(undefined);
    } catch {
      setError(t('settings.pluginOperationFailed', { code: 'bridge-unavailable' }));
      setSections([]);
      setDiagnostics([]);
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
      setDiagnostics((current) => current.filter((item) => item.settingId !== section.id));
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

  const withDescriptionTooltip = (section: PluginManagerPluginSettingSection, node: ReactNode): ReactNode => (
    section.description === undefined ? node : (
      <Tooltip label={section.description}>{node}</Tooltip>
    )
  );

  return (
    <div className="plugin-host-settings-fields">
      {error === undefined ? null : (
        <p className="plugin-settings-error" role="status">{error}</p>
      )}
      {sections.map((section) => {
        const fieldDisabled = disabled || savingId !== undefined;
        const diagnostic = diagnostics.find((item) => item.settingId === section.id);
        const fieldLoading = savingId === section.id;
        const fieldError = diagnostic?.message;
        const controlId = `plugin-setting-${encodeURIComponent(section.id)}`;
        const fieldAria = getFieldAriaProps(getFieldIds(controlId), {
          hasDescription: section.description !== undefined,
          hasError: fieldError !== undefined,
        });
        if (section.type === 'boolean') {
          const checked = section.value === true;
          return (
            <Field
              description={section.description}
              error={fieldError}
              htmlFor={controlId}
              key={section.id}
              label={section.title}
            >
              {withDescriptionTooltip(section, (
                <Switch
                  {...fieldAria}
                  checked={checked}
                  disabled={fieldDisabled}
                  id={controlId}
                  loading={fieldLoading}
                  onChange={(event) => void save(section, event.target.checked)}
                  title={section.description}
                />
              ))}
            </Field>
          );
        }
        if (section.type === 'select') {
          const options = section.options ?? [];
          const selectValue = resolvePluginSettingSelectValue(section);
          return (
            <Field
              description={section.description}
              error={fieldError}
              htmlFor={controlId}
              key={section.id}
              label={section.title}
            >
              {withDescriptionTooltip(section, (
                <Select
                  {...fieldAria}
                  disabled={fieldDisabled}
                  id={controlId}
                  loading={fieldLoading}
                  onValueChange={(value) => void save(section, value)}
                  options={options}
                  title={section.description}
                  value={selectValue}
                />
              ))}
            </Field>
          );
        }
        if (section.type === 'number') {
          const numericValue = typeof section.value === 'number' ? section.value : '';
          return (
            <Field
              description={section.description}
              error={fieldError}
              htmlFor={controlId}
              key={section.id}
              label={section.title}
            >
              {withDescriptionTooltip(section, (
                <TextField
                  {...fieldAria}
                  disabled={fieldDisabled}
                  id={controlId}
                  loading={fieldLoading}
                  max={section.maximum}
                  min={section.minimum}
                  onChange={(event) => {
                    const next = event.target.value.trim();
                    if (next === '') return;
                    const parsed = Number(next);
                    if (!Number.isFinite(parsed)) return;
                    void save(section, parsed);
                  }}
                  title={section.description}
                  type="number"
                  value={numericValue}
                />
              ))}
            </Field>
          );
        }
        if (section.type === 'slider') {
          const numericValue = typeof section.value === 'number'
            ? section.value
            : typeof section.default === 'number' ? section.default : section.minimum ?? 0;
          return (
            <Field
              description={section.description}
              error={fieldError}
              htmlFor={controlId}
              key={section.id}
              label={section.title}
            >
              {withDescriptionTooltip(section, (
                <Slider
                  {...fieldAria}
                  disabled={fieldDisabled}
                  id={controlId}
                  loading={fieldLoading}
                  max={section.maximum}
                  min={section.minimum}
                  onValueChange={(next) => void save(section, next)}
                  step={section.step}
                  value={numericValue}
                  valueText={String(numericValue)}
                  showValue
                  title={section.description}
                />
              ))}
            </Field>
          );
        }
        const textValue = typeof section.value === 'string' ? section.value : '';
        return (
          <Field
            description={section.description}
            error={fieldError}
            htmlFor={controlId}
            key={section.id}
            label={section.title}
          >
            {withDescriptionTooltip(section, (
              <TextField
                {...fieldAria}
                disabled={fieldDisabled}
                id={controlId}
                loading={fieldLoading}
                onBlur={(event) => void save(section, event.target.value)}
                onChange={(event) => {
                  const next = event.target.value;
                  setSections((current) => current.map((item) => (
                    item.id === section.id ? { ...item, value: next } : item
                  )));
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.currentTarget.blur();
                }}
                title={section.description}
                type="text"
                value={textValue}
              />
            ))}
          </Field>
        );
      })}
    </div>
  );
}
