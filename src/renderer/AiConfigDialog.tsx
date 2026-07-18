import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export interface AiConfigDialogProps {
  open: boolean;
  apiKey: string;
  provider: "openai" | "gemini" | "anthropic";
  model: string;
  language: string;
  hasKey: boolean;
  descriptionEnabled: boolean;
  tagsEnabled: boolean;
  structuredEnabled: boolean;
  disclaimerAccepted: boolean;
  autoAnalyzeEnabled: boolean;
  onApiKeyChange: (value: string) => void;
  onProviderChange: (value: "openai" | "gemini" | "anthropic") => void;
  onModelChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onDescriptionEnabledChange: (value: boolean) => void;
  onTagsEnabledChange: (value: boolean) => void;
  onStructuredEnabledChange: (value: boolean) => void;
  onDisclaimerAcceptedChange: (value: boolean) => void;
  onAutoAnalyzeEnabledChange: (value: boolean) => void;
  onClose: () => void;
  onSave: () => void;
}

export function AiConfigDialog({
  open,
  apiKey,
  provider,
  model,
  language,
  hasKey,
  descriptionEnabled,
  tagsEnabled,
  structuredEnabled,
  disclaimerAccepted,
  autoAnalyzeEnabled,
  onApiKeyChange,
  onProviderChange,
  onModelChange,
  onLanguageChange,
  onDescriptionEnabledChange,
  onTagsEnabledChange,
  onStructuredEnabledChange,
  onDisclaimerAcceptedChange,
  onAutoAnalyzeEnabledChange,
  onClose,
  onSave,
}: AiConfigDialogProps) {
  const t = useT();
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog" role="dialog">
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
        <p className="ai-config-note">{t("aiConfig.note")}</p>
        <div className="editor-field ai-config-field">
          <label className="micro-label">{t("aiConfig.provider")}</label>
          <select
            className="text-field ai-config-input"
            onChange={(e) =>
              onProviderChange(
                e.target.value as "openai" | "gemini" | "anthropic",
              )
            }
            value={provider}
          >
            <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
            <option value="gemini">Google Gemini</option>
            <option value="anthropic">Anthropic Claude</option>
          </select>
        </div>
        <div className="editor-field ai-config-field">
          <label className="micro-label">{t("aiConfig.model")}</label>
          <input
            className="text-field ai-config-input"
            maxLength={255}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder="gpt-4o-mini"
            value={model}
          />
        </div>
        <div className="editor-field ai-config-field">
          <label className="micro-label">API Key</label>
          <input
            className="text-field ai-config-input"
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
          <label className="micro-label">{t("aiConfig.language")}</label>
          <input
            className="text-field ai-config-input"
            maxLength={35}
            onChange={(e) => onLanguageChange(e.target.value)}
            placeholder={t("aiConfig.languagePlaceholder")}
            value={language}
          />
        </div>
        <div className="ai-config-switches">
          <label className="micro-label ai-config-switches-title">
            {t("aiConfig.fieldSwitches")}
          </label>
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
        <div className="dialog-actions ai-config-actions">
          <button
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary-button"
            disabled={!apiKey.trim() && !hasKey}
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
