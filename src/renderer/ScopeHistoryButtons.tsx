import { Icon } from "./Icons";
import { useT } from "./i18n";

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
  const t = useT();
  return (
    <div className="scope-history">
      <button
        aria-label={t("scope.back")}
        className="scope-history-button"
        disabled={!canBack}
        onClick={onBack}
        title={t("scope.back")}
        type="button"
      >
        <Icon name="chevron-left" size={14} />
      </button>
      <button
        aria-label={t("scope.forward")}
        className="scope-history-button"
        disabled={!canForward}
        onClick={onForward}
        title={t("scope.forward")}
        type="button"
      >
        <Icon name="chevron-right" size={14} />
      </button>
    </div>
  );
}
