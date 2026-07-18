import { Icon, type IconName } from './Icons';
import { iconActionAttrs } from './icon-action-attrs';

/**
 * REQ-SHELL-013: icon-only button with mirrored aria-label + title tooltip.
 */
export function IconActionButton({
  label,
  icon,
  size = 13,
  className = 'tiny-action',
  omitClassName = false,
  onClick,
  disabled,
}: {
  readonly label: string;
  readonly icon: IconName;
  readonly size?: number;
  readonly className?: string;
  /** When true, no className is set (parent CSS targets `button` directly). */
  readonly omitClassName?: boolean;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button
      {...(omitClassName ? {} : { className })}
      disabled={disabled}
      onClick={onClick}
      type="button"
      {...iconActionAttrs(label)}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
