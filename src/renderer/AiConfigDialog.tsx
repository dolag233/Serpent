import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  AI_OUTPUT_STYLES,
  DEFAULT_AI_DESCRIPTION_STRUCTURE,
  type AiAnalysisSettingsWire,
  type AiOutputStyle,
} from "../shared/ai-analysis-settings";
import {
  AI_API_FORMATS,
  AI_API_FORMAT_LABELS,
  AI_LANGUAGE_OPTIONS,
  DEFAULT_AI_BASE_URLS,
  type AiApiFormat,
  type AiLanguageId,
} from "../shared/ai-endpoints";
import type { AiReliabilitySettings } from "../shared/ai-reliability";
import { AiReliabilitySettingsFields } from "./AiReliabilitySettingsFields";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export type AiConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface AiConfigDialogProps {
  open: boolean;
  apiKey: string;
  apiFormat: AiApiFormat;
  model: string;
  baseUrl: string;
  languages: AiLanguageId[];
  concurrencyLimit: number;
  reliabilitySettings: AiReliabilitySettings;
  hasKey: boolean;
  descriptionEnabled: boolean;
  tagsEnabled: boolean;
  ratingEnabled: boolean;
  forceExistingTags: boolean;
  analysisSettings: AiAnalysisSettingsWire;
  disclaimerAccepted: boolean;
  autoAnalyzeEnabled: boolean;
  connectionState: AiConnectionState;
  connectionReason?: string;
  /** Shown while save is waiting on a connection probe. */
  saveVerifying?: boolean;
  onApiKeyChange: (value: string) => void;
  onApiFormatChange: (value: AiApiFormat) => void;
  onModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onLanguagesChange: (value: AiLanguageId[]) => void;
  onConcurrencyLimitChange: (value: number) => void;
  onReliabilitySettingsChange: (value: AiReliabilitySettings) => void;
  onDescriptionEnabledChange: (value: boolean) => void;
  onTagsEnabledChange: (value: boolean) => void;
  onRatingEnabledChange: (value: boolean) => void;
  onForceExistingTagsChange: (value: boolean) => void;
  onAnalysisSettingsChange: (value: AiAnalysisSettingsWire) => void;
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

const OUTPUT_STYLE_LABEL_KEY: Record<
  AiOutputStyle,
  "aiConfig.styleNormal" | "aiConfig.styleConcise" | "aiConfig.styleRigorous"
> = {
  normal: "aiConfig.styleNormal",
  concise: "aiConfig.styleConcise",
  rigorous: "aiConfig.styleRigorous",
};

export function AiConfigDialog({
  open,
  apiKey,
  apiFormat,
  model,
  baseUrl,
  languages,
  concurrencyLimit,
  reliabilitySettings,
  hasKey,
  descriptionEnabled,
  tagsEnabled,
  ratingEnabled,
  forceExistingTags,
  analysisSettings,
  disclaimerAccepted,
  autoAnalyzeEnabled,
  connectionState,
  connectionReason,
  saveVerifying = false,
  onApiKeyChange,
  onApiFormatChange,
  onModelChange,
  onBaseUrlChange,
  onLanguagesChange,
  onConcurrencyLimitChange,
  onReliabilitySettingsChange,
  onDescriptionEnabledChange,
  onTagsEnabledChange,
  onRatingEnabledChange,
  onForceExistingTagsChange,
  onAnalysisSettingsChange,
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
  const [modelsMessage, setModelsMessage] = useState<string | null>(null);
  const [testInline, setTestInline] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerMenuBox, setModelPickerMenuBox] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const modelsFetchInFlightRef = useRef(false);
  const modelPickerWrapRef = useRef<HTMLDivElement>(null);
  const modelPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const modelPickerMenuRef = useRef<HTMLUListElement>(null);
  const fetchedForRef = useRef<string | null>(null);

  const canUseKey = Boolean(apiKey.trim()) || hasKey;
  const language = languages[0] ?? "zh-CN";
  const modelsFetchKey = `${apiFormat}|${baseUrl.trim()}|${apiKey.trim() ? "typed" : hasKey ? "stored" : "none"}`;

  function patchSettings(patch: Partial<AiAnalysisSettingsWire>) {
    onAnalysisSettingsChange({ ...analysisSettings, ...patch });
  }

  async function runTest() {
    setBusyAction("test");
    setTestInline(null);
    try {
      const result = await onTestConnection();
      setTestInline({
        ok: result.success,
        text: result.success
          ? t("aiConfig.testOk")
          : (result.reason ?? t("aiConfig.testFailed")),
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function runFetchModels(options?: { quiet?: boolean }) {
    if (!canUseKey || modelsFetchInFlightRef.current) return;
    modelsFetchInFlightRef.current = true;
    setBusyAction("models");
    if (!options?.quiet) setModelsMessage(null);
    try {
      const result = await onFetchModels();
      fetchedForRef.current = modelsFetchKey;
      if (result.models.length > 0) {
        setModelOptions(result.models);
        setModelsMessage(
          options?.quiet
            ? null
            : t("aiConfig.fetchModelsOk").replace(
                "{count}",
                String(result.models.length),
              ),
        );
      } else {
        setModelOptions([]);
        setModelsMessage(result.reason ?? t("aiConfig.fetchModelsFailed"));
      }
    } finally {
      modelsFetchInFlightRef.current = false;
      setBusyAction(null);
    }
  }

  function syncModelPickerMenuBox() {
    const trigger = modelPickerTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, 180);
    const maxHeight = Math.min(240, window.innerHeight * 0.4);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const openUpward = spaceBelow < Math.min(maxHeight, 120) && rect.top > spaceBelow;
    const top = openUpward
      ? Math.max(8, rect.top - maxHeight - 4)
      : rect.bottom + 4;
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - width - 8,
    );
    setModelPickerMenuBox({ top, left, width });
  }

  async function toggleModelPicker() {
    if (!canUseKey) return;
    if (modelPickerOpen) {
      setModelPickerOpen(false);
      setModelPickerMenuBox(null);
      return;
    }
    setModelPickerOpen(true);
    syncModelPickerMenuBox();
    if (
      fetchedForRef.current !== modelsFetchKey ||
      modelOptions.length === 0
    ) {
      await runFetchModels();
      syncModelPickerMenuBox();
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
    setModelsMessage(null);
    setTestInline(null);
    setModelPickerOpen(false);
    setModelPickerMenuBox(null);
    fetchedForRef.current = null;
  }

  // Prefetch so the first dropdown open usually already has options.
  useEffect(() => {
    if (!open) {
      setModelPickerOpen(false);
      setModelPickerMenuBox(null);
      return;
    }
    if (!canUseKey) return;
    if (fetchedForRef.current === modelsFetchKey && modelOptions.length > 0) {
      return;
    }
    void runFetchModels({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fingerprint-driven
  }, [open, modelsFetchKey, canUseKey]);

  useEffect(() => {
    if (!modelPickerOpen) return;
    syncModelPickerMenuBox();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (modelPickerWrapRef.current?.contains(target)) return;
      if (modelPickerMenuRef.current?.contains(target)) return;
      setModelPickerOpen(false);
      setModelPickerMenuBox(null);
    };
    const onReposition = () => syncModelPickerMenuBox();
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", onReposition);
    // Dialog body scrolls clip absolute menus; keep fixed menu glued to trigger.
    document.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", onReposition);
      document.removeEventListener("scroll", onReposition, true);
    };
  }, [modelPickerOpen]);

  if (!open) return null;

  const busy = busyAction !== null || saveVerifying;
  const pickerLabel =
    busyAction === "models"
      ? t("aiConfig.fetchingModels")
      : modelOptions.includes(model)
        ? model
        : modelOptions.length > 0
          ? t("aiConfig.modelPick")
          : t("aiConfig.modelPickEmpty");

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-modal="true"
        className="create-dialog ai-config-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div className="ai-config-heading-main">
            <h2>{t("aiConfig.title")}</h2>
            {connectionState !== "idle" ? (
              <div
                className="ai-connection-indicator"
                data-state={connectionState}
                role="status"
              >
                <span aria-hidden="true" className="ai-connection-dot" />
                <span className="ai-connection-label">
                  {connectionState === "connecting"
                    ? t("aiConfig.connectionConnecting")
                    : connectionState === "connected"
                      ? t("aiConfig.connectionConnected")
                      : connectionState === "error"
                        ? t("aiConfig.connectionError")
                        : t("aiConfig.connectionDisconnected")}
                </span>
                {connectionReason ? (
                  <span className="ai-connection-reason" title={connectionReason}>
                    {connectionReason}
                  </span>
                ) : null}
              </div>
            ) : null}
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
              onChange={(e) => {
                onBaseUrlChange(e.target.value);
                setTestInline(null);
              }}
              placeholder={DEFAULT_AI_BASE_URLS[apiFormat]}
              spellCheck={false}
              value={baseUrl}
            />
            <p className="ai-config-hint">
              {apiFormat === "dashscope_native"
                ? t("aiConfig.dashscopeBaseUrlHint")
                : t("aiConfig.baseUrlHint")}
            </p>
          </div>
          <div className="editor-field ai-config-field">
            <label className="micro-label" htmlFor="ai-config-api-key">
              {t("aiConfig.apiKey")}
            </label>
            <div className="ai-config-api-key-row">
              <input
                className="text-field ai-config-input"
                id="ai-config-api-key"
                maxLength={512}
                onChange={(e) => {
                  onApiKeyChange(e.target.value);
                  setTestInline(null);
                }}
                placeholder={
                  hasKey ? t("aiConfig.apiKeyConfigured") : "sk-…"
                }
                type={showApiKey ? "text" : "password"}
                value={apiKey}
              />
              <button
                className="ai-config-visibility-toggle"
                onClick={() => setShowApiKey((prev) => !prev)}
                type="button"
                {...iconActionAttrs(
                  showApiKey
                    ? t("aiConfig.hideApiKey")
                    : t("aiConfig.showApiKey"),
                )}
              >
                <Icon name={showApiKey ? "eye-off" : "eye"} size={14} />
              </button>
            </div>
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
                onChange={(e) => {
                  onModelChange(e.target.value);
                  setTestInline(null);
                }}
                placeholder={
                  apiFormat === "dashscope_native"
                    ? "qwen3-vl-plus"
                    : apiFormat.startsWith("openai")
                    ? "gpt-4o-mini"
                    : apiFormat === "gemini_native"
                      ? "gemini-2.0-flash"
                      : "claude-sonnet-4-20250514"
                }
                value={model}
              />
              <div
                className="ai-config-model-picker-wrap"
                ref={modelPickerWrapRef}
              >
                <button
                  aria-expanded={modelPickerOpen}
                  aria-haspopup="listbox"
                  aria-label={t("aiConfig.modelPick")}
                  className="text-field ai-config-input ai-config-model-picker-trigger"
                  disabled={!canUseKey}
                  onClick={() => void toggleModelPicker()}
                  ref={modelPickerTriggerRef}
                  title={
                    !canUseKey
                      ? t("aiConfig.modelPickEmpty")
                      : t("aiConfig.modelPick")
                  }
                  type="button"
                >
                  <span className="ai-config-model-picker-label">
                    {pickerLabel}
                  </span>
                  <Icon name="chevron" size={12} />
                </button>
                {modelPickerOpen && modelPickerMenuBox
                  ? createPortal(
                      <ul
                        aria-label={t("aiConfig.modelPick")}
                        className="ai-config-model-picker-menu is-portaled"
                        ref={modelPickerMenuRef}
                        role="listbox"
                        style={{
                          top: modelPickerMenuBox.top,
                          left: modelPickerMenuBox.left,
                          width: modelPickerMenuBox.width,
                        }}
                      >
                        {busyAction === "models" &&
                        modelOptions.length === 0 ? (
                          <li
                            className="ai-config-model-picker-empty"
                            role="option"
                          >
                            {t("aiConfig.fetchingModels")}
                          </li>
                        ) : modelOptions.length === 0 ? (
                          <li
                            className="ai-config-model-picker-empty"
                            role="option"
                          >
                            {modelsMessage ?? t("aiConfig.modelPickEmpty")}
                          </li>
                        ) : (
                          modelOptions.map((id) => (
                            <li key={id} role="presentation">
                              <button
                                aria-selected={id === model}
                                className={
                                  id === model
                                    ? "ai-config-model-picker-option is-selected"
                                    : "ai-config-model-picker-option"
                                }
                                onClick={() => {
                                  onModelChange(id);
                                  setTestInline(null);
                                  setModelPickerOpen(false);
                                  setModelPickerMenuBox(null);
                                }}
                                role="option"
                                type="button"
                              >
                                {id}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>,
                      document.body,
                    )
                  : null}
              </div>
            </div>
            {modelsMessage ? (
              <p className="ai-config-hint" role="status">
                {modelsMessage}
              </p>
            ) : null}
          </div>
          <div className="editor-field ai-config-field">
            <label className="micro-label" htmlFor="ai-config-language">
              {t("aiConfig.language")}
            </label>
            <select
              className="text-field ai-config-input"
              id="ai-config-language"
              onChange={(e) =>
                onLanguagesChange([e.target.value as AiLanguageId])
              }
              value={language}
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
                    key: "rating",
                    label: t("aiConfig.rating"),
                    state: ratingEnabled,
                    setter: onRatingEnabledChange,
                  },
                  {
                    key: "forceTags",
                    label: t("aiConfig.forceExistingTags"),
                    state: forceExistingTags,
                    setter: onForceExistingTagsChange,
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
          <details className="ai-config-advanced">
            <summary className="ai-config-advanced-summary">
              {t("aiConfig.advanced")}
            </summary>
            <div className="ai-config-advanced-body">
              <div className="editor-field ai-config-field">
                <label className="micro-label" htmlFor="ai-config-concurrency-limit">
                  {t("aiConfig.concurrencyLimit")}
                </label>
                <input
                  className="text-field ai-config-input"
                  id="ai-config-concurrency-limit"
                  max={32}
                  min={1}
                  onChange={(e) => {
                    const value = Number.parseInt(e.target.value, 10);
                    onConcurrencyLimitChange(
                      Number.isFinite(value)
                        ? Math.min(32, Math.max(1, value))
                        : 16,
                    );
                  }}
                  type="number"
                  value={concurrencyLimit}
                />
                <p className="ai-config-hint">{t("aiConfig.concurrencyLimitHint")}</p>
              </div>
              <AiReliabilitySettingsFields
                onChange={onReliabilitySettingsChange}
                settings={reliabilitySettings}
              />
              <div className="editor-field ai-config-field">
                <label className="micro-label" htmlFor="ai-config-max-tags">
                  {t("aiConfig.maxTags")}
                </label>
                <input
                  className="text-field ai-config-input"
                  id="ai-config-max-tags"
                  max={32}
                  min={1}
                  onChange={(e) =>
                    patchSettings({
                      maxTags: Number.parseInt(e.target.value, 10) || 8,
                    })
                  }
                  type="number"
                  value={analysisSettings.maxTags}
                />
              </div>
              <div className="ai-config-advanced-row">
                <div className="editor-field ai-config-field">
                  <label
                    className="micro-label"
                    htmlFor="ai-config-max-desc-zh"
                  >
                    {t("aiConfig.maxDescriptionCharsZh")}
                  </label>
                  <input
                    className="text-field ai-config-input"
                    id="ai-config-max-desc-zh"
                    max={500}
                    min={20}
                    onChange={(e) =>
                      patchSettings({
                        maxDescriptionCharsZh:
                          Number.parseInt(e.target.value, 10) || 100,
                      })
                    }
                    type="number"
                    value={analysisSettings.maxDescriptionCharsZh}
                  />
                </div>
                <div className="editor-field ai-config-field">
                  <label
                    className="micro-label"
                    htmlFor="ai-config-max-desc-en"
                  >
                    {t("aiConfig.maxDescriptionWordsEn")}
                  </label>
                  <input
                    className="text-field ai-config-input"
                    id="ai-config-max-desc-en"
                    max={200}
                    min={10}
                    onChange={(e) =>
                      patchSettings({
                        maxDescriptionWordsEn:
                          Number.parseInt(e.target.value, 10) || 60,
                      })
                    }
                    type="number"
                    value={analysisSettings.maxDescriptionWordsEn}
                  />
                </div>
              </div>
              <div className="editor-field ai-config-field">
                <label className="micro-label" htmlFor="ai-config-output-style">
                  {t("aiConfig.outputStyle")}
                </label>
                <select
                  className="text-field ai-config-input"
                  id="ai-config-output-style"
                  onChange={(e) =>
                    patchSettings({
                      outputStyle: e.target.value as AiOutputStyle,
                    })
                  }
                  value={analysisSettings.outputStyle}
                >
                  {AI_OUTPUT_STYLES.map((style) => (
                    <option key={style} value={style}>
                      {t(OUTPUT_STYLE_LABEL_KEY[style])}
                    </option>
                  ))}
                </select>
              </div>
              <div className="editor-field ai-config-field">
                <label className="micro-label" htmlFor="ai-config-rating-rubric">
                  {t("aiConfig.ratingRubric")}
                </label>
                <textarea
                  className="text-field ai-config-input ai-config-textarea"
                  id="ai-config-rating-rubric"
                  maxLength={4000}
                  onChange={(e) =>
                    patchSettings({ ratingRubric: e.target.value })
                  }
                  rows={3}
                  value={analysisSettings.ratingRubric}
                />
              </div>
              <div className="editor-field ai-config-field">
                <label
                  className="micro-label"
                  htmlFor="ai-config-custom-desc-prompt"
                >
                  {t("aiConfig.customDescriptionPrompt")}
                </label>
                <textarea
                  className="text-field ai-config-input ai-config-textarea"
                  id="ai-config-custom-desc-prompt"
                  maxLength={4000}
                  onChange={(e) =>
                    patchSettings({ customDescriptionPrompt: e.target.value })
                  }
                  placeholder={DEFAULT_AI_DESCRIPTION_STRUCTURE}
                  rows={3}
                  value={analysisSettings.customDescriptionPrompt}
                />
                <p className="ai-config-hint">
                  {t("aiConfig.customDescriptionPromptHint")}
                </p>
              </div>
            </div>
          </details>
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
        </div>
        <div className="dialog-actions ai-config-actions">
          <div className="ai-config-test-cluster">
            <button
              className="secondary-button"
              disabled={!canUseKey || !model.trim() || busy}
              onClick={() => void runTest()}
              type="button"
            >
              {busyAction === "test"
                ? t("aiConfig.testing")
                : t("aiConfig.testConnection")}
            </button>
            {testInline ? (
              <span
                className="ai-config-test-inline"
                data-ok={testInline.ok ? "true" : "false"}
                role="status"
              >
                {testInline.text}
              </span>
            ) : null}
          </div>
          <button
            className="primary-button"
            disabled={!canUseKey || !model.trim() || busy}
            onClick={() => void onSave()}
            type="button"
          >
            {saveVerifying ? t("aiConfig.savingVerifying") : t("aiConfig.save")}
          </button>
        </div>
        {saveVerifying ? (
          <p className="ai-config-save-wait" role="status">
            {t("aiConfig.saveVerifyingHint")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
