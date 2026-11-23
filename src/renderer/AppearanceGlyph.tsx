import { memo } from "react";
import type { EntityAppearance } from "../shared/entity-appearance";
import { APPEARANCE_ICON_PATHS } from "./appearance-icon-paths";
import { Icon, type IconName } from "./Icons";

export const CHROME_APPEARANCE_ICONS = new Set<string>([
  "heart",
  "star",
  "globe",
  "palette",
]);

export function appearanceColorVar(colorId: string | null | undefined): string | undefined {
  return colorId ? `var(--appearance-color-${colorId})` : undefined;
}

export const AppearanceGlyph = memo(function AppearanceGlyph({
  appearance,
  fallback,
  size = 15,
  color,
  linkedBadge,
}: {
  appearance?: EntityAppearance | null;
  fallback: IconName;
  size?: number;
  color?: string;
  linkedBadge?: "link" | "link-off" | null;
}) {
  const tint = appearanceColorVar(appearance?.colorId) ?? color;
  let glyph;
  if (appearance?.glyphKind === "emoji" && appearance.glyphValue) {
    glyph = (
      <span className="nav-entity-glyph-emoji" style={{ fontSize: Math.max(11, size - 1) }}>
        {appearance.glyphValue}
      </span>
    );
  } else if (appearance?.glyphKind === "icon" && appearance.glyphValue) {
    if (CHROME_APPEARANCE_ICONS.has(appearance.glyphValue)) {
      glyph = <Icon name={appearance.glyphValue as IconName} size={size} color={tint} />;
    } else {
      const path = APPEARANCE_ICON_PATHS[appearance.glyphValue];
      glyph = path ? (
        <svg
          aria-hidden="true"
          className="icon"
          style={tint ? { color: tint } : undefined}
          viewBox="0 0 24 24"
          width={size}
          height={size}
        >
          {path}
        </svg>
      ) : (
        <Icon name={fallback} size={size} color={tint} />
      );
    }
  } else {
    glyph = <Icon name={fallback} size={size} color={tint} />;
  }

  return (
    <span className="nav-entity-glyph" style={tint ? { color: tint } : undefined}>
      {glyph}
      {linkedBadge ? (
        <span className="nav-entity-glyph-badge" aria-hidden="true">
          <Icon name={linkedBadge} size={8} />
        </span>
      ) : null}
    </span>
  );
});
