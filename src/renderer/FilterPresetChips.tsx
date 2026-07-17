import { rangesEqual, type RangeStrings } from "./filter-presets";

// ---------------------------------------------------------------------------
// FilterPresetChips (REQ-FILTER-009 / REQ-FILTER-010)
//
// One-tap dimension presets for the discovery filter panel. A chip is active
// when the current range exactly equals the preset's; the parent applies
// togglePresetRange so clicking an active chip clears the range.
// ---------------------------------------------------------------------------

export function FilterPresetChips({
  label,
  presets,
  current,
  onToggle,
  disabled,
}: {
  label: string;
  presets: readonly { label: string; range: RangeStrings }[];
  current: RangeStrings;
  onToggle: (range: RangeStrings) => void;
  disabled?: boolean;
}) {
  return (
    <div aria-label={label} className="filter-presets" role="group">
      {presets.map((preset) => {
        const active = rangesEqual(current, preset.range);
        return (
          <button
            aria-pressed={active}
            className={`filter-preset-chip${active ? " is-active" : ""}`}
            disabled={disabled}
            key={preset.label}
            onClick={() => onToggle(preset.range)}
            type="button"
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
