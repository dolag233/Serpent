import { useState } from "react";
import { Icon } from "./Icons";
import { useT } from "./i18n";
import type { LinkedFolderRule } from "../shared/asset-types";

export interface LinkedRulesDialogProps {
  name: string;
  initialRules: LinkedFolderRule[];
  onClose: () => void;
  onSave: (rules: LinkedFolderRule[]) => void;
}

export function LinkedRulesDialog({
  name,
  initialRules,
  onClose,
  onSave,
}: LinkedRulesDialogProps) {
  const t = useT();
  const [rules, setRules] = useState<LinkedFolderRule[]>(initialRules);

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-modal="true"
        className="create-dialog"
        role="dialog"
        style={{ maxWidth: 700 }}
      >
        <div className="dialog-heading">
          <div>
            <h2>{t("dialog.linkedRules.title", { name })}</h2>
          </div>
          <button
            aria-label={t("common.cancel")}
            className="dialog-close"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="field-help">{t("dialog.linkedRules.help")}</p>
        {rules.map((rule, index) => (
          <div
            key={rule.ruleId}
            style={{
              display: "grid",
              gridTemplateColumns: "22px 82px 82px 1fr 28px",
              gap: 6,
              marginTop: 6,
            }}
          >
            <input
              aria-label={t("dialog.linkedRules.enableRule", {
                index: index + 1,
              })}
              checked={rule.enabled}
              onChange={(event) =>
                setRules((current) =>
                  current.map((item, i) =>
                    i === index
                      ? { ...item, enabled: event.target.checked }
                      : item,
                  ),
                )
              }
              type="checkbox"
            />
            <select
              className="text-field"
              onChange={(event) =>
                setRules((current) =>
                  current.map((item, i) =>
                    i === index
                      ? {
                          ...item,
                          action: event.target.value as LinkedFolderRule["action"],
                        }
                      : item,
                  ),
                )
              }
              value={rule.action}
            >
              <option value="exclude">{t("dialog.linkedRules.exclude")}</option>
              <option value="include">{t("dialog.linkedRules.include")}</option>
            </select>
            <select
              className="text-field"
              onChange={(event) =>
                setRules((current) =>
                  current.map((item, i) =>
                    i === index
                      ? {
                          ...item,
                          target: event.target.value as LinkedFolderRule["target"],
                        }
                      : item,
                  ),
                )
              }
              value={rule.target}
            >
              <option value="folder">{t("dialog.linkedRules.folder")}</option>
              <option value="filename">{t("dialog.linkedRules.filename")}</option>
              <option value="extension">{t("dialog.linkedRules.extension")}</option>
              <option value="path">{t("dialog.linkedRules.path")}</option>
            </select>
            <input
              className="text-field"
              maxLength={512}
              onChange={(event) =>
                setRules((current) =>
                  current.map((item, i) =>
                    i === index
                      ? { ...item, pattern: event.target.value }
                      : item,
                  ),
                )
              }
              value={rule.pattern}
            />
            <button
              aria-label={t("dialog.linkedRules.deleteRule", {
                index: index + 1,
              })}
              className="dialog-close"
              onClick={() =>
                setRules((current) =>
                  current.filter((_, i) => i !== index),
                )
              }
              type="button"
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={() =>
              setRules((current) => [
                ...current,
                {
                  ruleId: crypto.randomUUID(),
                  action: "exclude",
                  target: "extension",
                  pattern: "tmp",
                  enabled: true,
                },
              ])
            }
            type="button"
          >
            {t("dialog.linkedRules.add")}
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
            disabled={rules.some((rule) => !rule.pattern.trim())}
            onClick={() => onSave(rules)}
            type="button"
          >
            {t("dialog.linkedRules.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
