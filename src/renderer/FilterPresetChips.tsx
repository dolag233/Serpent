import {
  isPresetRangeSelected,
  type RangeStrings,
} from "./filter-presets";

// ---------------------------------------------------------------------------
// FilterPresetChips (REQ-FILTER-009 / REQ-FILTER-010 / Serpent-gp4)
//
// One-tap dimension presets. A chip is active when its range is among the
// selected ranges; the parent applies togglePresetRanges (Shift = OR).
// ---------------------------------------------------------------------------

export function FilterPresetChips({
  label,
  presets,
  selected,
  onToggle,
  disabled,
}: {
  label: string;
  presets: readonly { label: string; range: RangeStrings }[];
  /** Selected numeric ranges (OR within the dimension). */
  selected: readonly RangeStrings[];
  onToggle: (range: RangeStrings, shiftKey: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div aria-label={label} className="filter-presets" role="group">
      {presets.map((preset) => {
        const active = isPresetRangeSelected(selected, preset.range);
        return (
          <button
            aria-pressed={active}
            className={`filter-preset-chip${active ? " is-active" : ""}`}
            disabled={disabled}
            key={preset.label}
            onClick={(event) => onToggle(preset.range, event.shiftKey)}
            type="button"
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
