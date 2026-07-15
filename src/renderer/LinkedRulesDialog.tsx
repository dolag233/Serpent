import { useState } from "react";
import { Icon } from "./Icons";
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
            <span className="eyebrow">LINKED FOLDER FILTER</span>
            <h2>{name} · 过滤规则</h2>
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
        <p className="field-help">
          从上到下执行，最后一个匹配项生效；仅支持受约束的路径、文件名、扩展名和文件夹规则。
        </p>
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
              aria-label={`启用规则 ${index + 1}`}
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
              <option value="exclude">排除</option>
              <option value="include">包含</option>
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
              <option value="folder">文件夹</option>
              <option value="filename">文件名</option>
              <option value="extension">扩展名</option>
              <option value="path">路径</option>
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
              aria-label={`删除规则 ${index + 1}`}
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
            添加规则
          </button>
          <button
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="primary-button"
            disabled={rules.some((rule) => !rule.pattern.trim())}
            onClick={() => onSave(rules)}
            type="button"
          >
            保存并刷新
          </button>
        </div>
      </div>
    </div>
  );
}
