import { Icon } from "./Icons";

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
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <h2>AI 配置 (BYOK)</h2>
          </div>
          <button
            aria-label="取消"
            className="dialog-close"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="ai-config-note">
          配置第三方云端视觉模型 API Key。Key
          将加密存储于本地操作系统安全凭据中，Serpent
          不代理、不计费、不追踪额度。
        </p>
        <div className="editor-field ai-config-field">
          <label className="micro-label">供应商</label>
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
          <label className="micro-label">模型</label>
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
            placeholder={hasKey ? "（已配置，重新输入可覆盖）" : "sk-…"}
            type="password"
            value={apiKey}
          />
        </div>
        <div className="editor-field ai-config-field">
          <label className="micro-label">语言</label>
          <input
            className="text-field ai-config-input"
            maxLength={35}
            onChange={(e) => onLanguageChange(e.target.value)}
            placeholder="auto (跟随系统)"
            value={language}
          />
        </div>
        <div className="ai-config-switches">
          <label className="micro-label ai-config-switches-title">
            AI 写入开关（按字段）
          </label>
          {(
            [
              {
                key: "description",
                label: "描述",
                state: descriptionEnabled,
                setter: onDescriptionEnabledChange,
              },
              {
                key: "tags",
                label: "标签 (Tags)",
                state: tagsEnabled,
                setter: onTagsEnabledChange,
              },
              {
                key: "structured",
                label: "结构化元信息",
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
            <span>
              我了解启用 AI
              分析会将选中资产的图像或视频联系表上传给所选第三方供应商，并可能产生费用。
            </span>
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
            导入后自动上传并分析支持的资产
          </label>
        </div>
        <div className="dialog-actions ai-config-actions">
          <button
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="primary-button"
            disabled={!apiKey.trim() && !hasKey}
            onClick={() => void onSave()}
            type="button"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}
