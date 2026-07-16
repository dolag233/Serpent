import { Icon } from "./Icons";

export type ScopeHistoryButtonsProps = {
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
};

/**
 * Workspace back/forward controls. Rendered as the leftmost controls of the
 * app toolbar (before the navigation toggle), so they always sit left of the
 * current directory breadcrumb trail.
 */
export function ScopeHistoryButtons({
  canBack,
  canForward,
  onBack,
  onForward,
}: ScopeHistoryButtonsProps) {
  return (
    <div className="scope-history">
      <button
        aria-label="后退"
        className="scope-history-button"
        disabled={!canBack}
        onClick={onBack}
        title="后退"
        type="button"
      >
        <Icon name="chevron-left" size={14} />
      </button>
      <button
        aria-label="前进"
        className="scope-history-button"
        disabled={!canForward}
        onClick={onForward}
        title="前进"
        type="button"
      >
        <Icon name="chevron-right" size={14} />
      </button>
    </div>
  );
}
