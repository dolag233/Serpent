import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createShellPortal } from "./ui/ShellStyleScope";

import {
  AI_OUTPUT_STYLES,
  normalizeAiMaxDescriptionCharsZh,
  normalizeAiMaxDescriptionWordsEn,
  normalizeAiMaxTags,
  type AiAnalysisSettingsWire,
  type AiOutputStyle,
} from "../shared/ai-analysis-settings";
import { normalizeAiAnalysisImageEdgePx } from "../shared/ai-analysis-image";
import { normalizeAiAnalysisConcurrency } from "../shared/ai-concurrency";
import {
  AI_API_FORMATS,
  AI_API_FORMAT_LABELS,
  AI_LANGUAGE_OPTIONS,
  anthropicCustomBaseUrlMissesProtocolPath,
  DEFAULT_AI_BASE_URLS,
  DEFAULT_AI_MODELS,
  type AiApiFormat,
  type AiLanguageId,
} from "../shared/ai-endpoints";
import { Icon } from "./Icons";
import { AiConfigNumberInput } from "./ai-config-number-input";
import { buildAiModelsFetchKey } from "./ai-model-fetch-key";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";
import { Select } from "./ui/primitives/Select";

export type AiConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface AiConfigDialogProps {
  open: boolean;
  /** Renders inside the settings center instead of a modal dialog. */
  variant?: "dialog" | "embedded";
  apiKey: string;
  profiles: Array<{
    id: string;
    name: string;
    apiFormat: AiApiFormat;
    model: string;
    baseUrl: string;
    hasCredential: boolean;
  }>;
  activeProfileId: string | null;
  profileDraftId: string | null;
  profileName: string;
  apiFormat: AiApiFormat;
  model: string;
  baseUrl: string;
  languages: AiLanguageId[];
  concurrencyLimit: number;
  maxAnalysisImageEdgePx: number;
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
  onProfileNameChange: (value: string) => void;
  onNewProfile: () => void;
  onSelectProfile: (id: string) => void;
  onActivateProfile: (id: string) => void;
  onDeleteProfile: (id: string) => void;
  onClearCredential: () => void;
  onApiFormatChange: (value: AiApiFormat) => void;
  onModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onLanguagesChange: (value: AiLanguageId[]) => void;
  onConcurrencyLimitChange: (value: number) => void;
  onMaxAnalysisImageEdgePxChange: (value: number) => void;
  onDescriptionEnabledChange: (value: boolean) => void;
  onTagsEnabledChange: (value: boolean) => void;
  onRatingEnabledChange: (value: boolean) => void;
  onForceExistingTagsChange: (value: boolean) => void;
  onAnalysisSettingsChange: (value: AiAnalysisSettingsWire) => void;
  /** Blur-commit for advanced numeric fields: updates state and persists. */
  onCommitAnalysisSettingsPatch?: (
    patch: Partial<AiAnalysisSettingsWire>,
  ) => void;
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
  variant = "dialog",
  apiKey,
  profiles,
  activeProfileId,
  profileDraftId,
  profileName,
  apiFormat,
  model,
  baseUrl,
  languages,
  concurrencyLimit,
  maxAnalysisImageEdgePx,
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
  onProfileNameChange,
  onNewProfile,
  onSelectProfile,
  onActivateProfile,
  onDeleteProfile,
  onClearCredential,
  onApiFormatChange,
  onModelChange,
  onBaseUrlChange,
  onLanguagesChange,
  onConcurrencyLimitChange,
  onMaxAnalysisImageEdgePxChange,
  onDescriptionEnabledChange,
  onTagsEnabledChange,
  onRatingEnabledChange,
  onForceExistingTagsChange,
  onAnalysisSettingsChange,
  onCommitAnalysisSettingsPatch,
  onDisclaimerAcceptedChange,
  onAutoAnalyzeEnabledChange,
  onClose,
  onSave,
  onTestConnection,
  onFetchModels,
}: AiConfigDialogProps) {
  const t = useT();
  const [modelOptionsState, setModelOptions] = useState<{
    fetchKey: string;
    models: string[];
  } | null>(null);
  const [modelsFetchRetry, setModelsFetchRetry] = useState(0);
  const [busyAction, setBusyAction] = useState<"test" | "models" | null>(null);
  const [modelsMessageState, setModelsMessage] = useState<{
    fetchKey: string;
    message: string | null;
  } | null>(null);
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
    inModal: boolean;
  } | null>(null);
  const modelsFetchInFlightRef = useRef(false);
  const modelPickerWrapRef = useRef<HTMLDivElement>(null);
  const modelPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const modelPickerMenuRef = useRef<HTMLUListElement>(null);
  const fetchedForRef = useRef<string | null>(null);

  const canUseKey = Boolean(apiKey.trim()) || hasKey;
  const selectedProfile = profiles.find((profile) => profile.id === profileDraftId);
  const profileDraftIsDirty = selectedProfile !== undefined && (
    selectedProfile.name !== profileName.trim()
    || selectedProfile.apiFormat !== apiFormat
    || selectedProfile.model !== model.trim()
    || selectedProfile.baseUrl !== baseUrl.trim()
    || Boolean(apiKey.trim())
  );
  const language = languages[0] ?? "zh-CN";
  const modelsFetchKey = buildAiModelsFetchKey({
    profileId: profileDraftId,
    apiFormat,
    baseUrl,
    apiKey,
    hasStoredKey: hasKey,
  });
  const modelsFetchKeyRef = useRef(modelsFetchKey);
  useLayoutEffect(() => {
    modelsFetchKeyRef.current = modelsFetchKey;
  }, [modelsFetchKey]);
  const modelsMessage = modelsMessageState?.fetchKey === modelsFetchKey
    ? modelsMessageState.message
    : null;
  const modelOptions = modelOptionsState?.fetchKey === modelsFetchKey
    ? modelOptionsState.models
    : [];

  function patchSettings(patch: Partial<AiAnalysisSettingsWire>) {
    onAnalysisSettingsChange({ ...analysisSettings, ...patch });
  }

  function commitNumericSettings(patch: Partial<AiAnalysisSettingsWire>) {
    if (onCommitAnalysisSettingsPatch) {
      onCommitAnalysisSettingsPatch(patch);
      return;
    }
    patchSettings(patch);
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
    const requestFetchKey = modelsFetchKey;
    modelsFetchInFlightRef.current = true;
    setBusyAction("models");
    if (!options?.quiet) {
      setModelsMessage({ fetchKey: requestFetchKey, message: null });
    }
    try {
      const result = await onFetchModels();
      if (modelsFetchKeyRef.current !== requestFetchKey) return;
      fetchedForRef.current = requestFetchKey;
      if (result.models.length > 0) {
        setModelOptions({ fetchKey: requestFetchKey, models: result.models });
        setModelsMessage({
          fetchKey: requestFetchKey,
          message: options?.quiet
            ? null
            : t("aiConfig.fetchModelsOk").replace(
                "{count}",
                String(result.models.length),
              ),
        });
      } else {
        setModelOptions({ fetchKey: requestFetchKey, models: [] });
        setModelsMessage({
          fetchKey: requestFetchKey,
          message: result.reason ?? t("aiConfig.fetchModelsFailed"),
        });
      }
    } finally {
      modelsFetchInFlightRef.current = false;
      setBusyAction(null);
      if (modelsFetchKeyRef.current !== requestFetchKey) {
        setModelsFetchRetry((retry) => retry + 1);
      }
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
    setModelPickerMenuBox({ top, left, width, inModal: trigger.closest('[role="dialog"]') !== null });
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
    setModelOptions(null);
    setModelsMessage({ fetchKey: modelsFetchKey, message: null });
    setTestInline(null);
    setModelPickerOpen(false);
    setModelPickerMenuBox(null);
    fetchedForRef.current = null;
  }

  // Prefetch so the first dropdown open usually already has options.
  useEffect(() => {
    if (!open) {
      queueMicrotask(() => {
        setModelPickerOpen(false);
        setModelPickerMenuBox(null);
      });
      return;
    }
    if (!canUseKey) return;
    if (fetchedForRef.current === modelsFetchKey && modelOptions.length > 0) {
      return;
    }
    void runFetchModels({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fingerprint-driven
  }, [open, modelsFetchKey, canUseKey, modelsFetchRetry]);

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
  const canSaveProfile = Boolean(model.trim()) && !busy;
  const embedded = variant === "embedded";
  const pickerLabel =
    busyAction === "models"
      ? t("aiConfig.fetchingModels")
      : modelOptions.includes(model)
        ? model
        : modelOptions.length > 0
          ? t("aiConfig.modelPick")
          : t("aiConfig.modelPickEmpty");

  const showHeading =
    !embedded || connectionState !== "idle" || Boolean(connectionReason);

  const content = (
    <>
        {showHeading ? (
          <div className="dialog-heading">
            <div className="ai-config-heading-main">
              {!embedded ? <h2>{t("aiConfig.title")}</h2> : null}
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
                    <span
                      className="ai-connection-reason"
                      data-hover-tip={connectionReason}
                    >
                      {connectionReason}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {!embedded ? (
              <button
                className="dialog-close"
                onClick={onClose}
                type="button"
                {...iconActionAttrs(t("common.cancel"))}
              >
                <Icon name="close" size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="ai-config-dialog-body">
          <p className="ai-config-note">{t("aiConfig.note")}</p>
          <div className="micro-label ai-config-section-title">{t("aiConfig.modelConfiguration")}</div>
          <div className="ai-config-profile-row">
            <div className="editor-field ai-config-field">
              <label className="micro-label" htmlFor="ai-config-profile">
                {t("aiConfig.savedProfiles")}
              </label>
              <Select
                className="text-field ai-config-input"
                id="ai-config-profile"
                onValueChange={onSelectProfile}
                options={[
                  { value: "", label: t("aiConfig.newProfileOption") },
                  ...profiles.map((profile) => ({
                    value: profile.id,
                    label: `${profile.name}${profile.id === activeProfileId ? ` · ${t("aiConfig.activeProfile")}` : ""}${!profile.hasCredential ? ` · ${t("aiConfig.missingCredential")}` : ""}`,
                  })),
                ]}
                value={profileDraftId ?? ""}
              />
            </div>
            <button className="secondary-button" onClick={onNewProfile} type="button">
              {t("aiConfig.addProfile")}
            </button>
            {profileDraftId ? (
              <button
                className="secondary-button"
                onClick={() => {
                  onDeleteProfile(profileDraftId);
                }}
                type="button"
              >
                {t("aiConfig.deleteProfile")}
              </button>
            ) : null}
            {profileDraftId && profileDraftId !== activeProfileId ? (
              <button
                className="secondary-button"
                disabled={!selectedProfile?.hasCredential || profileDraftIsDirty || busy}
                onClick={() => onActivateProfile(profileDraftId)}
                type="button"
              >
                {t("aiConfig.activateProfile")}
              </button>
            ) : null}
          </div>
          {profileDraftId && !selectedProfile?.hasCredential ? (
            <p className="ai-config-hint">{t("aiConfig.profileNeedsKey")}</p>
          ) : null}
          {profileDraftId && selectedProfile?.hasCredential && profileDraftIsDirty ? (
            <p className="ai-config-hint">{t("aiConfig.profileSaveBeforeActivate")}</p>
          ) : null}
          <div className="editor-field ai-config-field">
            <label className="micro-label" htmlFor="ai-config-profile-name">
              {t("aiConfig.profileName")}
            </label>
            <input
              className="text-field ai-config-input"
              id="ai-config-profile-name"
              maxLength={80}
              onChange={(event) => onProfileNameChange(event.target.value)}
              value={profileName}
            />
          </div>
          <div className="editor-field ai-config-field">
            <label className="micro-label" htmlFor="ai-config-api-format">
              {t("aiConfig.apiFormat")}
            </label>
            <Select
              className="text-field ai-config-input"
              id="ai-config-api-format"
              onValueChange={(value) => handleApiFormatChange(value as AiApiFormat)}
              options={AI_API_FORMATS.map((id) => ({
                value: id,
                label: AI_API_FORMAT_LABELS[id],
              }))}
              value={apiFormat}
            />
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
            {apiFormat === "anthropic" && anthropicCustomBaseUrlMissesProtocolPath(baseUrl) ? (
              <p className="ai-config-hint">{t("aiConfig.baseUrlAnthropicPathHint")}</p>
            ) : null}
          </div>
          <div className="editor-field ai-config-field">
            <label className="micro-label" htmlFor="ai-config-api-key">
              {t("aiConfig.apiKey")}
            </label>
            <div className="field-with-visibility-toggle">
              <input
                className="text-field ai-config-input field-with-visibility-input"
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
                className="visibility-toggle"
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
            {profileDraftId && hasKey ? (
              <button
                className="secondary-button"
                onClick={onClearCredential}
                type="button"
              >
                {t("aiConfig.clearApiKey")}
              </button>
            ) : null}
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
                placeholder={DEFAULT_AI_MODELS[apiFormat]}
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
                  data-hover-tip={
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
                  ? createShellPortal(
                      <ul
                        aria-label={t("aiConfig.modelPick")}
                        className="ui-menu-surface ai-config-model-picker-menu is-portaled"
                        data-modal-popover={modelPickerMenuBox.inModal || undefined}
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
          <div className="micro-label ai-config-section-title">{t("aiConfig.analysisBehavior")}</div>
          <div className="editor-field ai-config-field">
            <label className="micro-label" htmlFor="ai-config-language">
              {t("aiConfig.language")}
            </label>
            <Select
              className="text-field ai-config-input"
              id="ai-config-language"
              onValueChange={(value) => onLanguagesChange([value as AiLanguageId])}
              options={AI_LANGUAGE_OPTIONS.map((option) => ({
                value: option.id,
                label: option.labelZh === option.labelEn
                  ? option.labelEn
                  : `${option.labelZh} / ${option.labelEn}`,
              }))}
              value={language}
            />
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
                <AiConfigNumberInput
                  id="ai-config-concurrency-limit"
                  normalize={normalizeAiAnalysisConcurrency}
                  onCommit={onConcurrencyLimitChange}
                  value={concurrencyLimit}
                />
                <p className="ai-config-hint">{t("aiConfig.concurrencyLimitHint")}</p>
              </div>
              <div className="editor-field ai-config-field">
                <label className="micro-label" htmlFor="ai-config-max-image-edge">
                  {t("aiConfig.maxAnalysisImageEdge")}
                </label>
                <AiConfigNumberInput
                  id="ai-config-max-image-edge"
                  normalize={normalizeAiAnalysisImageEdgePx}
                  onCommit={onMaxAnalysisImageEdgePxChange}
                  value={maxAnalysisImageEdgePx}
                />
                <p className="ai-config-hint">{t("aiConfig.maxAnalysisImageEdgeHint")}</p>
              </div>
              <div
                className={`editor-field ai-config-field${tagsEnabled ? "" : " is-disabled"}`}
              >
                <label className="micro-label" htmlFor="ai-config-max-tags">
                  {t("aiConfig.maxTags")}
                </label>
                <AiConfigNumberInput
                  disabled={!tagsEnabled}
                  id="ai-config-max-tags"
                  normalize={normalizeAiMaxTags}
                  onCommit={(maxTags) => commitNumericSettings({ maxTags })}
                  value={analysisSettings.maxTags}
                />
              </div>
              <div
                className={`editor-field ai-config-field${tagsEnabled ? "" : " is-disabled"}`}
              >
                <label className="micro-label" htmlFor="ai-config-custom-tag-prompt">
                  {t("aiConfig.customTagPrompt")}
                </label>
                <textarea
                  className="text-field ai-config-input ai-config-textarea"
                  disabled={!tagsEnabled}
                  id="ai-config-custom-tag-prompt"
                  maxLength={4000}
                  onChange={(e) =>
                    patchSettings({ customTagPrompt: e.target.value })
                  }
                  rows={3}
                  value={analysisSettings.customTagPrompt}
                />
                <p className="ai-config-hint">
                  {t("aiConfig.customTagPromptHint")}
                </p>
              </div>
              <div
                className={`ai-config-advanced-row${descriptionEnabled ? "" : " is-disabled"}`}
              >
                <div className="editor-field ai-config-field">
                  <label
                    className="micro-label"
                    htmlFor="ai-config-max-desc-zh"
                  >
                    {t("aiConfig.maxDescriptionCharsZh")}
                  </label>
                  <AiConfigNumberInput
                    disabled={!descriptionEnabled}
                    id="ai-config-max-desc-zh"
                    normalize={normalizeAiMaxDescriptionCharsZh}
                    onCommit={(maxDescriptionCharsZh) =>
                      commitNumericSettings({ maxDescriptionCharsZh })
                    }
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
                  <AiConfigNumberInput
                    disabled={!descriptionEnabled}
                    id="ai-config-max-desc-en"
                    normalize={normalizeAiMaxDescriptionWordsEn}
                    onCommit={(maxDescriptionWordsEn) =>
                      commitNumericSettings({ maxDescriptionWordsEn })
                    }
                    value={analysisSettings.maxDescriptionWordsEn}
                  />
                </div>
              </div>
              <div className="editor-field ai-config-field">
                <label className="micro-label" htmlFor="ai-config-output-style">
                  {t("aiConfig.outputStyle")}
                </label>
                <Select
                  className="text-field ai-config-input"
                  id="ai-config-output-style"
                  onValueChange={(value) => patchSettings({
                    outputStyle: value as AiOutputStyle,
                  })}
                  options={AI_OUTPUT_STYLES.map((style) => ({
                    value: style,
                    label: t(OUTPUT_STYLE_LABEL_KEY[style]),
                  }))}
                  value={analysisSettings.outputStyle}
                />
              </div>
              <div
                className={`editor-field ai-config-field${ratingEnabled ? "" : " is-disabled"}`}
              >
                <label className="micro-label" htmlFor="ai-config-rating-rubric">
                  {t("aiConfig.ratingRubric")}
                </label>
                <textarea
                  className="text-field ai-config-input ai-config-textarea"
                  disabled={!ratingEnabled}
                  id="ai-config-rating-rubric"
                  maxLength={4000}
                  onChange={(e) =>
                    patchSettings({ ratingRubric: e.target.value })
                  }
                  rows={3}
                  value={analysisSettings.ratingRubric}
                />
              </div>
              <div
                className={`editor-field ai-config-field${descriptionEnabled ? "" : " is-disabled"}`}
              >
                <label
                  className="micro-label"
                  htmlFor="ai-config-custom-desc-prompt"
                >
                  {t("aiConfig.customDescriptionPrompt")}
                </label>
                <textarea
                  className="text-field ai-config-input ai-config-textarea"
                  disabled={!descriptionEnabled}
                  id="ai-config-custom-desc-prompt"
                  maxLength={4000}
                  onChange={(e) =>
                    patchSettings({ customDescriptionPrompt: e.target.value })
                  }
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
            disabled={!canSaveProfile}
            onClick={() => void onSave()}
            type="button"
          >
            {saveVerifying ? t("aiConfig.savingVerifying") : t("aiConfig.saveProfile")}
          </button>
        </div>
        {saveVerifying ? (
          <p className="ai-config-save-wait" role="status">
            {t("aiConfig.saveVerifyingHint")}
          </p>
        ) : null}
    </>
  );

  if (embedded) {
    return (
      <div className="ai-config-embedded">
        <div>{content}</div>
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog ai-config-dialog"
        contentClassName="ui-dialog-shell__content--flush"
        dialogId="ai-config-dialog"
        onRequestClose={onClose}
      >
        {content}
      </DialogShell>
    </div>
  );
}
