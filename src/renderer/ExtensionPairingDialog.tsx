import { Icon } from "./Icons";

export interface ExtensionPairingDialogProps {
  open: boolean;
  token: string;
  error: string | null;
  onClose: () => void;
  onRotate: () => void;
  onCopy: () => void;
}

export function ExtensionPairingDialog({
  open,
  token,
  error,
  onClose,
  onRotate,
  onCopy,
}: ExtensionPairingDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="extension-pairing-title"
        aria-modal="true"
        className="create-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">BROWSER EXTENSION PAIRING</span>
            <h2 id="extension-pairing-title">浏览器扩展配对</h2>
          </div>
          <button
            aria-label="关闭浏览器扩展配对"
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
          将配对码粘贴到 Chrome 或 Edge 的 Serpent
          扩展选项中。配对码由操作系统安全存储加密保存；此窗口关闭后不会在界面中保留明文。
        </p>
        {error ? (
          <p role="alert" style={{ color: "var(--warning)", fontSize: 12 }}>
            {error}
          </p>
        ) : (
          <>
            <label
              className="field-label"
              htmlFor="extension-pairing-token"
            >
              配对码
            </label>
            <input
              className="text-field"
              id="extension-pairing-token"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              spellCheck={false}
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
              }}
              value={token || "正在读取…"}
            />
            <p className="field-help">
              轮换会使所有浏览器中保存的旧配对码立即失效。
            </p>
          </>
        )}
        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={!token}
            onClick={() => void onRotate()}
            type="button"
          >
            轮换配对码
          </button>
          <button
            className="primary-button"
            disabled={!token}
            onClick={() => void onCopy()}
            type="button"
          >
            复制配对码
          </button>
        </div>
      </div>
    </div>
  );
}
