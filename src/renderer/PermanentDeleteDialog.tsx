import React from "react";
import { Icon } from "./Icons";

export interface PermanentDeleteDialogProps {
  assetCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function PermanentDeleteDialog({
  assetCount,
  onCancel,
  onConfirm,
}: PermanentDeleteDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <h2>永久删除确认</h2>
          </div>
          <button
            aria-label="取消"
            className="dialog-close"
            onClick={onCancel}
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
          确定要永久删除所选 {assetCount} 项资产吗？文件将从回收站彻底移除，此操作不可撤销。
        </p>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="primary-button"
            onClick={onConfirm}
            type="button"
          >
            永久删除 {assetCount} 项
          </button>
        </div>
      </div>
    </div>
  );
}
