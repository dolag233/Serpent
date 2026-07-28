import { type ReactNode } from "react";

import type { AppLogEntry, ReadAppLogResult, SerializedLogError } from "../shared/app-log";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export type AppLogDialogProps = {
  open: boolean;
  entries: AppLogEntry[];
  loading: boolean;
  errorCode: Extract<ReadAppLogResult, { ok: false }>["code"] | null;
  onClose: () => void;
  onRefresh: () => void;
  onReveal: () => void;
};

function errorText(entry: AppLogEntry): string | null {
  if (!entry.error) return null;
  if ("message" in entry.error) {
    const messages: string[] = [];
    let current: SerializedLogError | { value: string } | { truncated: true } | undefined = entry.error;
    for (let depth = 0; current && depth < 6; depth += 1) {
      if ("message" in current && current.message) {
        messages.push("code" in current && current.code ? `${current.code}: ${current.message}` : current.message);
      }
      if (!("cause" in current)) break;
      current = current.cause;
    }
    if (messages.length) return messages.join(" → ");
  }
  if ("value" in entry.error) return entry.error.value;
  return "Diagnostic details were truncated.";
}

function contextText(entry: AppLogEntry): string | null {
  if (!entry.context || Object.keys(entry.context).length === 0) return null;
  return JSON.stringify(entry.context, null, 2);
}

export function AppLogDialog({
  open,
  entries,
  loading,
  errorCode,
  onClose,
  onRefresh,
  onReveal,
}: AppLogDialogProps): ReactNode {
  const t = useT();
  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        aria-labelledby="app-log-dialog-title"
        aria-modal="true"
        className="create-dialog app-log-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="app-log-dialog-title">{t("dialog.appLog.title")}</h2>
            <p className="app-log-subtitle">{t("dialog.appLog.subtitle")}</p>
          </div>
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("dialog.appLog.closeAria"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="dialog-actions dialog-actions-start app-log-actions">
          <button className="secondary-button" disabled={loading} onClick={onRefresh} type="button">
            {loading ? t("dialog.appLog.refreshing") : t("dialog.appLog.refresh")}
          </button>
          <button className="secondary-button" onClick={onReveal} type="button">
            {t("dialog.appLog.reveal")}
          </button>
        </div>
        {errorCode ? (
          <p className="field-help app-log-state">{t("dialog.appLog.readFailed")}</p>
        ) : entries.length === 0 && !loading ? (
          <p className="field-help app-log-state">{t("dialog.appLog.empty")}</p>
        ) : (
          <div aria-live="polite" className="app-log-list">
            {entries.map((entry, index) => {
              const detail = errorText(entry);
              const context = contextText(entry);
              return (
                <article className={`app-log-entry is-${entry.level}`} key={`${entry.timestamp}-${index}`}>
                  <div className="app-log-entry-heading">
                    <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
                    <strong>{entry.scope}</strong>
                  </div>
                  {entry.message ? <p>{entry.message}</p> : null}
                  {detail ? <p className="app-log-error-detail">{detail}</p> : null}
                  {context ? (
                    <details>
                      <summary>{t("dialog.appLog.details")}</summary>
                      <pre>{context}</pre>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
