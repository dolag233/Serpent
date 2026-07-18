import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
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
        className="scope-history-button"
        disabled={!canBack}
        onClick={onBack}
        type="button"
        {...iconActionAttrs(t("scope.back"))}
      >
        <Icon name="chevron-left" size={14} />
      </button>
      <button
        className="scope-history-button"
        disabled={!canForward}
        onClick={onForward}
        type="button"
        {...iconActionAttrs(t("scope.forward"))}
      >
        <Icon name="chevron-right" size={14} />
      </button>
    </div>
  );
}
