import { memo } from "react";
import { Icon } from "./Icons";

/** Keep stable tree controls independent of unrelated browse updates. */
export const NavTreeDisclosure = memo(function NavTreeDisclosure({
  entityId,
  expanded,
  label,
  onToggle,
}: {
  entityId: string;
  expanded: boolean;
  label: string;
  onToggle: (entityId: string) => void;
}) {
  return (
    <button
      aria-expanded={expanded}
      aria-label={label}
      className={`nav-disclosure${expanded ? " is-expanded" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(entityId);
      }}
      type="button"
    >
      <Icon name="chevron-right" size={12} />
    </button>
  );
});
