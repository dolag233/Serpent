import { Icon } from "./Icons";
import { IconActionButton } from "./icon-action-button";
import { useT } from "./i18n";
import type { ToastMessage } from './toast-notifications';

export interface WorkspaceNoticeBannerProps {
  readonly message: ToastMessage;
  readonly closing: boolean;
  readonly undoLabel?: string;
  readonly onUndo?: () => void;
  readonly onDismiss: () => void;
  readonly onTransitionEnd: (event: React.TransitionEvent) => void;
}

/**
 * Unified top-center shell notice for info/warning/error (Serpent-ss1k / nlji).
 */
export function WorkspaceNoticeBanner({
  message,
  closing,
  undoLabel,
  onUndo,
  onDismiss,
  onTransitionEnd,
}: WorkspaceNoticeBannerProps) {
  const t = useT();
  const kindClass =
    message.kind === "error"
      ? " is-error"
      : message.kind === "warning"
        ? " is-warning"
        : "";
  const iconName =
    message.kind === "error" || message.kind === "warning" ? "warning" : "info";
  return (
    <div
      className={`workspace-notice${kindClass}${closing ? ' is-closing' : ''}`}
      onTransitionEnd={onTransitionEnd}
      role={message.kind === "error" ? "alert" : "status"}
    >
      <Icon name={iconName} size={15} />
      <span className="workspace-notice-text">{message.text}</span>
      {undoLabel && onUndo ? (
        <button className="secondary-button" onClick={onUndo} type="button">
          {undoLabel}
        </button>
      ) : null}
      <IconActionButton
        omitClassName
        icon="close"
        label={t('common.closeHint')}
        onClick={onDismiss}
      />
    </div>
  );
}
