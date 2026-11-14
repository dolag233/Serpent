import { useState } from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export function RatingStars({ value, disabled, onChange }: {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const t = useT();
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const preview = disabled ? value : (hovered ?? focused ?? value);
  return <span className="rating-stars" onMouseLeave={() => setHovered(null)}>
    {[1, 2, 3, 4, 5].map(star => <button
      key={star}
      type="button"
      className="rating-star"
      disabled={disabled}
      aria-pressed={star <= value || undefined}
      data-active={star <= preview || undefined}
      onMouseEnter={() => setHovered(star)}
      onFocus={event => { if (event.currentTarget.matches(":focus-visible")) setFocused(star); }}
      onBlur={() => setFocused(null)}
      onClick={() => onChange(star)}
      {...iconActionAttrs(t("inspector.starAria", { star }))}
    ><Icon name="star" size={16} /></button>)}
  </span>;
}
