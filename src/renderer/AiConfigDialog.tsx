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
            <span className="eyebrow">AI CONFIGURATION</span>
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
        <p
          style={{
            color: "var(--secondary)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          配置第三方云端视觉模型 API Key。Key
          将加密存储于本地操作系统安全凭据中，Serpent
          不代理、不计费、不追踪额度。
        </p>
        <div className="editor-field" style={{ marginTop: 12 }}>
          <label className="micro-label">供应商</label>
          <select
            className="text-field"
            onChange={(e) =>
              onProviderChange(
                e.target.value as "openai" | "gemini" | "anthropic",
              )
            }
            style={{ height: 30, fontSize: 12, marginTop: 3 }}
            value={provider}
          >
            <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
            <option value="gemini">Google Gemini</option>
            <option value="anthropic">Anthropic Claude</option>
          </select>
        </div>
        <div className="editor-field" style={{ marginTop: 10 }}>
          <label className="micro-label">模型</label>
          <input
            className="text-field"
            maxLength={255}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder="gpt-4o-mini"
            style={{ height: 28, fontSize: 11, marginTop: 3 }}
            value={model}
          />
        </div>
        <div className="editor-field" style={{ marginTop: 10 }}>
          <label className="micro-label">API Key</label>
          <input
            className="text-field"
            maxLength={512}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={hasKey ? "（已配置，重新输入可覆盖）" : "sk-…"}
            style={{ height: 28, fontSize: 11, marginTop: 3 }}
            type="password"
            value={apiKey}
          />
        </div>
        <div className="editor-field" style={{ marginTop: 10 }}>
          <label className="micro-label">语言</label>
          <input
            className="text-field"
            maxLength={35}
            onChange={(e) => onLanguageChange(e.target.value)}
            placeholder="auto (跟随系统)"
            style={{ height: 28, fontSize: 11, marginTop: 3 }}
            value={language}
          />
        </div>
        <div style={{ marginTop: 14 }}>
          <label
            className="micro-label"
            style={{ marginBottom: 5, display: "block" }}
          >
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
            <label
              key={field.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "3px 0",
                color: "#c7cac7",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <input
                checked={field.state}
                onChange={(e) => field.setter(e.target.checked)}
                type="checkbox"
              />
              {field.label}
            </label>
          ))}
        </div>
        <div
          style={{
            marginTop: 14,
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              color: "#c7cac7",
              fontSize: 12,
              cursor: "pointer",
              lineHeight: 1.5,
            }}
          >
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
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 9,
              color: disclaimerAccepted ? "#c7cac7" : "var(--tertiary)",
              fontSize: 12,
              cursor: disclaimerAccepted ? "pointer" : "not-allowed",
            }}
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
        <div className="dialog-actions" style={{ marginTop: 14 }}>
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
