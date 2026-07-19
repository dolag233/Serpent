import { useState } from "react";

import {
  AI_API_FORMATS,
  AI_API_FORMAT_LABELS,
  AI_LANGUAGE_OPTIONS,
  DEFAULT_AI_BASE_URLS,
  type AiApiFormat,
  type AiLanguageId,
} from "../shared/ai-endpoints";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export interface AiConfigDialogProps {
  open: boolean;
  apiKey: string;
  apiFormat: AiApiFormat;
  model: string;
  baseUrl: string;
  languages: AiLanguageId[];
  hasKey: boolean;
  descriptionEnabled: boolean;
  tagsEnabled: boolean;
  structuredEnabled: boolean;
  disclaimerAccepted: boolean;
  autoAnalyzeEnabled: boolean;
  onApiKeyChange: (value: string) => void;
  onApiFormatChange: (value: AiApiFormat) => void;
  onModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onLanguagesChange: (value: AiLanguageId[]) => void;
  onDescriptionEnabledChange: (value: boolean) => void;
  onTagsEnabledChange: (value: boolean) => void;
  onStructuredEnabledChange: (value: boolean) => void;
  onDisclaimerAcceptedChange: (value: boolean) => void;
  onAutoAnalyzeEnabledChange: (value: boolean) => void;
  onClose: () => void;
  onSave: () => void;
  onTestConnection: () => Promise<{
    success: boolean;
    reason?: string;
  }>;
  onFetchModels: () => Promise<{
    models: string[];
    reason?: string;
  }>;
}

export function AiConfigDialog({
  open,
  apiKey,
  apiFormat,
  model,
  baseUrl,
  languages,
  hasKey,
  descriptionEnabled,
  tagsEnabled,
  structuredEnabled,
  disclaimerAccepted,
  autoAnalyzeEnabled,
  onApiKeyChange,
  onApiFormatChange,
  onModelChange,
  onBaseUrlChange,
  onLanguagesChange,
  onDescriptionEnabledChange,
  onTagsEnabledChange,
  onStructuredEnabledChange,
  onDisclaimerAcceptedChange,
  onAutoAnalyzeEnabledChange,
  onClose,
  onSave,
  onTestConnection,
  onFetchModels,
}: AiConfigDialogProps) {
  const t = useT();
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<"test" | "models" | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  if (!open) return null;

  const canUseKey = Boolean(apiKey.trim()) || hasKey;

  async function runTest() {
    setBusyAction("test");
    setActionMessage(null);
    try {
      const result = await onTestConnection();
      setActionMessage(
        result.success
          ? t("aiConfig.testOk")
          : (result.reason ?? t("aiConfig.testFailed")),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function runFetchModels() {
    setBusyAction("models");
    setActionMessage(null);
    try {
      const result = await onFetchModels();
      if (result.models.length > 0) {
        setModelOptions(result.models);
        setActionMessage(
          t("aiConfig.fetchModelsOk").replace(
            "{count}",
            String(result.models.length),
          ),
        );
      } else {
        setModelOptions([]);
        setActionMessage(result.reason ?? t("aiConfig.fetchModelsFailed"));
      }
    } finally {
      setBusyAction(null);
    }
  }

  function handleApiFormatChange(next: AiApiFormat) {
    const previousDefault = DEFAULT_AI_BASE_URLS[apiFormat];
    const current = baseUrl.trim();
    onApiFormatChange(next);
    if (!current || current === previousDefault) {
      onBaseUrlChange("");
    }
    setModelOptions([]);
    setActionMessage(null);
  }

  const modelPickerValue = modelOptions.includes(model) ? model : "";

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-modal="true"
        className="create-dialog ai-config-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2>{t("aiConfig.title")}</h2>
          </div>
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="ai-config-dialog-body">
          <p className="ai-config-note">{t("aiConfig.note")}</p>
          <div className="editor-field ai-config-field">
            <label className="micro-label" htmlFor="ai-config-api-format">
              {t("aiConfig.apiFormat")}
            </label>
            <select
              className="text-field ai-config-input"
              id="ai-config-api-format"
              onChange={(e) =>
                handleApiFormatChange(e.target.value as AiApiFormat)
              }
              value={apiFormat}
            >
              {AI_API_FORMATS.map((id) => (
                <option key={id} value={id}>
                  {AI_API_FORMAT_LABELS[id]}
                </option>
              ))}
            </select>
            <p className="ai-config-hint">{t("aiConfig.apiFormatHint")}</p>
          </div>
          <div className="editor-field ai-config-field">
            <label className="micro-label" htmlFor="ai-config-base-url">
              {t("aiConfig.baseUrl")}
            </label>
            <input
              className="text-field ai-config-input"
              id="ai-config-base-url"
              maxLength={2048}
              onChange={(e) => onBaseUrlChange(e.target.value)}
              placeholder={DEFAULT_AI_BASE_URLS[apiFormat]}
              spellCheck={false}
              value={baseUrl}
            />
            <p className="ai-config-hint">{t("aiConfig.baseUrlHint")}</p>
          </div>
          <div className="editor-field ai-config-field">
            <label className="micro-label" htmlFor="ai-config-api-key">
              {t("aiConfig.apiKey")}
            </label>
            <input
              className="text-field ai-config-input"
              id="ai-config-api-key"
              maxLength={512}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder={
                hasKey ? t("aiConfig.apiKeyConfigured") : "sk-…"
              }
              type="password"
              value={apiKey}
            />
          </div>
          <div className="editor-field ai-config-field">
            <label className="micro-label" htmlFor="ai-config-model">
              {t("aiConfig.model")}
            </label>
            <div className="ai-config-model-row">
              <input
                className="text-field ai-config-input"
                id="ai-config-model"
                maxLength={255}
                onChange={(e) => onModelChange(e.target.value)}
                placeholder={
                  apiFormat.startsWith("openai")
                    ? "gpt-4o-mini"
                    : apiFormat === "gemini_native"
                      ? "gemini-2.0-flash"
                      : "claude-sonnet-4-20250514"
                }
                value={model}
              />
              <select
                aria-label={t("aiConfig.modelPick")}
                className="text-field ai-config-input ai-config-model-picker"
                disabled={modelOptions.length === 0}
                id="ai-config-model-picker"
                onChange={(e) => {
                  const next = e.target.value;
                  if (next) onModelChange(next);
                }}
                title={
                  modelOptions.length === 0
                    ? t("aiConfig.modelPickEmpty")
                    : t("aiConfig.modelPick")
                }
                value={modelPickerValue}
              >
                <option value="">
                  {modelOptions.length === 0
                    ? t("aiConfig.modelPickEmpty")
                    : t("aiConfig.modelPick")}
                </option>
                {modelOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
            <div className="ai-config-model-actions">
              <button
                className="secondary-button"
                disabled={!canUseKey || busyAction !== null}
                onClick={() => void runFetchModels()}
                type="button"
              >
                {busyAction === "models"
                  ? t("aiConfig.fetchingModels")
                  : t("aiConfig.fetchModels")}
              </button>
            </div>
          </div>
          <div className="editor-field ai-config-field">
            <label className="micro-label" htmlFor="ai-config-languages">
              {t("aiConfig.language")}
            </label>
            <select
              className="text-field ai-config-input ai-config-languages"
              id="ai-config-languages"
              multiple
              onChange={(e) => {
                const selected = Array.from(
                  e.target.selectedOptions,
                  (option) => option.value as AiLanguageId,
                );
                if (selected.length === 0) return;
                onLanguagesChange(selected);
              }}
              size={4}
              value={languages}
            >
              {AI_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.labelZh === option.labelEn
                    ? option.labelEn
                    : `${option.labelZh} / ${option.labelEn}`}
                </option>
              ))}
            </select>
            <p className="ai-config-hint">{t("aiConfig.languageHint")}</p>
          </div>
          <div className="ai-config-switches">
            <span className="micro-label ai-config-switches-title">
              {t("aiConfig.fieldSwitches")}
            </span>
            <div className="ai-config-switches-row">
              {(
                [
                  {
                    key: "description",
                    label: t("aiConfig.description"),
                    state: descriptionEnabled,
                    setter: onDescriptionEnabledChange,
                  },
                  {
                    key: "tags",
                    label: t("aiConfig.tags"),
                    state: tagsEnabled,
                    setter: onTagsEnabledChange,
                  },
                  {
                    key: "structured",
                    label: t("aiConfig.structured"),
                    state: structuredEnabled,
                    setter: onStructuredEnabledChange,
                  },
                ] as const
              ).map((field) => (
                <label className="ai-config-check-row" key={field.key}>
                  <input
                    checked={field.state}
                    onChange={(e) => field.setter(e.target.checked)}
                    type="checkbox"
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </div>
          <div className="ai-config-consent">
            <label className="ai-config-check-row ai-config-check-row-top">
              <input
                checked={disclaimerAccepted}
                onChange={(e) => {
                  onDisclaimerAcceptedChange(e.target.checked);
                  if (!e.target.checked) onAutoAnalyzeEnabledChange(false);
                }}
                type="checkbox"
              />
              <span>{t("aiConfig.disclaimer")}</span>
            </label>
            <label
              className="ai-config-check-row ai-config-check-row-indent"
              data-disabled={!disclaimerAccepted || undefined}
            >
              <input
                checked={autoAnalyzeEnabled}
                disabled={!disclaimerAccepted}
                onChange={(e) => onAutoAnalyzeEnabledChange(e.target.checked)}
                type="checkbox"
              />
              {t("aiConfig.autoAnalyze")}
            </label>
          </div>
          {actionMessage ? (
            <p className="ai-config-action-message" role="status">
              {actionMessage}
            </p>
          ) : null}
        </div>
        <div className="dialog-actions ai-config-actions">
          <button
            className="secondary-button"
            disabled={!canUseKey || !model.trim() || busyAction !== null}
            onClick={() => void runTest()}
            type="button"
          >
            {busyAction === "test"
              ? t("aiConfig.testing")
              : t("aiConfig.testConnection")}
          </button>
          <button
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary-button"
            disabled={!canUseKey || !model.trim() || languages.length === 0}
            onClick={() => void onSave()}
            type="button"
          >
            {t("aiConfig.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
