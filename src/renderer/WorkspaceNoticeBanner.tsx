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
 * Info/notice channel anchored to the active workspace top center (Serpent-ss1k).
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
  return (
    <div
      className={`workspace-notice${closing ? ' is-closing' : ''}`}
      onTransitionEnd={onTransitionEnd}
      role="status"
    >
      <Icon name="info" size={15} />
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
