import React from "react";
import { Icon } from "./Icons";

export interface DeleteLinkedDialogProps {
  displayNames: string;
  deleteSourceFile: boolean;
  canDeleteSourceFile: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onToggleDeleteSourceFile: (checked: boolean) => void;
}

export function DeleteLinkedDialog({
  displayNames,
  deleteSourceFile,
  canDeleteSourceFile,
  onClose,
  onConfirm,
  onToggleDeleteSourceFile,
}: DeleteLinkedDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <h2>删除链接资产</h2>
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
          确定要从 Serpent 中移除链接资产"{displayNames}
          "吗？默认只移除索引记录，磁盘源文件保持不变。
        </p>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginTop: 12,
            color: "#c7cac7",
            fontSize: 12,
            cursor: canDeleteSourceFile
              ? "pointer"
              : "not-allowed",
            lineHeight: 1.5,
          }}
        >
          <input
            aria-label="同时删除磁盘源文件"
            checked={deleteSourceFile}
            disabled={!canDeleteSourceFile}
            onChange={(event) =>
              onToggleDeleteSourceFile(event.target.checked)
            }
            type="checkbox"
          />
          <span>
            {canDeleteSourceFile
              ? "同时将磁盘源文件移入系统回收站。系统拒绝操作时，该项源文件和 Serpent 记录都会保留，并显示具体原因。"
              : "源文件当前不可用，只能移除 Serpent 中的链接记录。"}
          </span>
        </label>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="primary-button"
            onClick={onConfirm}
            type="button"
          >
            {deleteSourceFile
              ? "移入系统回收站并移除"
              : "仅移除记录"}
          </button>
        </div>
      </div>
    </div>
  );
}
