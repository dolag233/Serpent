import { Icon } from "./Icons";
import { IconActionButton } from "./icon-action-button";
import { useT } from "./i18n";
import type { ToastMessage } from './toast-notifications';
import { Notice } from './ui/patterns';

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
  const iconName =
    message.kind === "error" || message.kind === "warning" ? "warning" : "info";
  return (
    <Notice
      actions={(
        <span className="workspace-notice-actions">
          {undoLabel && onUndo ? (
            <IconActionButton
              className="workspace-notice-undo"
              icon="undo"
              label={undoLabel}
              onClick={onUndo}
              size={14}
            />
          ) : null}
        </span>
      )}
      className={`workspace-notice${closing ? ' is-closing' : ''}`}
      dismissLabel={t('common.closeHint')}
      dismissible
      leading={(
        <span className="workspace-notice-icon" aria-hidden>
          <Icon name={iconName} size={15} />
        </span>
      )}
      message={message.text}
      onTransitionEnd={onTransitionEnd}
      onDismiss={onDismiss}
      tone={message.kind === "notice" ? "info" : message.kind}
    >
    </Notice>
  );
}
