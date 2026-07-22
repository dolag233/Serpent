import {
  normalizeAiReliabilitySettings,
  type AiReliabilitySettings,
} from "../shared/ai-reliability";
import { useT } from "./i18n";

export interface AiReliabilitySettingsFieldsProps {
  settings: AiReliabilitySettings;
  onChange: (value: AiReliabilitySettings) => void;
}

/**
 * Keeps the queue/retry controls independent from the much larger AI provider
 * dialog, so their persisted runtime semantics remain easy to inspect.
 */
export function AiReliabilitySettingsFields({
  settings,
  onChange,
}: AiReliabilitySettingsFieldsProps) {
  const t = useT();
  const patch = (value: Partial<AiReliabilitySettings>) => {
    onChange(normalizeAiReliabilitySettings({ ...settings, ...value }));
  };

  return (
    <>
      <div className="ai-config-advanced-row">
        <div className="editor-field ai-config-field">
          <label className="micro-label" htmlFor="ai-config-request-timeout">
            {t("aiConfig.requestTimeout")}
          </label>
          <input
            className="text-field ai-config-input"
            id="ai-config-request-timeout"
            max={600}
            min={15}
            onChange={(event) => patch({
              requestTimeoutMs: (Number.parseInt(event.target.value, 10) || 120) * 1_000,
            })}
            type="number"
            value={Math.round(settings.requestTimeoutMs / 1_000)}
          />
        </div>
        <div className="editor-field ai-config-field">
          <label className="micro-label" htmlFor="ai-config-max-attempts">
            {t("aiConfig.maxAttempts")}
          </label>
          <input
            className="text-field ai-config-input"
            id="ai-config-max-attempts"
            max={10}
            min={1}
            onChange={(event) => patch({
              maxAttempts: Number.parseInt(event.target.value, 10) || 3,
            })}
            type="number"
            value={settings.maxAttempts}
          />
        </div>
      </div>
      <div className="ai-config-advanced-row">
        <div className="editor-field ai-config-field">
          <label className="micro-label" htmlFor="ai-config-retry-base-delay">
            {t("aiConfig.retryBaseDelay")}
          </label>
          <input
            className="text-field ai-config-input"
            id="ai-config-retry-base-delay"
            max={60}
            min={0.1}
            onChange={(event) => patch({
              retryBaseDelayMs: Math.round((Number.parseFloat(event.target.value) || 1) * 1_000),
            })}
            step={0.1}
            type="number"
            value={settings.retryBaseDelayMs / 1_000}
          />
        </div>
        <div className="editor-field ai-config-field">
          <label className="micro-label" htmlFor="ai-config-retry-max-delay">
            {t("aiConfig.retryMaxDelay")}
          </label>
          <input
            className="text-field ai-config-input"
            id="ai-config-retry-max-delay"
            max={600}
            min={1}
            onChange={(event) => patch({
              retryMaxDelayMs: Math.round((Number.parseFloat(event.target.value) || 30) * 1_000),
            })}
            step={1}
            type="number"
            value={settings.retryMaxDelayMs / 1_000}
          />
        </div>
      </div>
      <div className="editor-field ai-config-field">
        <label className="micro-label" htmlFor="ai-config-retry-jitter">
          {t("aiConfig.retryJitter")}
        </label>
        <input
          className="text-field ai-config-input"
          id="ai-config-retry-jitter"
          max={50}
          min={0}
          onChange={(event) => patch({
            retryJitterRatio: (Number.parseFloat(event.target.value) || 0) / 100,
          })}
          step={1}
          type="number"
          value={Math.round(settings.retryJitterRatio * 100)}
        />
        <p className="ai-config-hint">{t("aiConfig.reliabilityHint")}</p>
      </div>
    </>
  );
}
