import type { Dispatch, SetStateAction } from "react";

import { useT } from "./i18n";

export type TechnicalRangeInput = {
  min: string;
  max: string;
  exclude: boolean;
};

export function TechnicalRangeFilter({
  label,
  range,
  setRange,
  step = "1",
}: {
  label: string;
  range: TechnicalRangeInput;
  setRange: Dispatch<SetStateAction<TechnicalRangeInput>>;
  step?: string;
}) {
  const t = useT();
  return (
    <label>
      {label}
      <div className="numeric-filter-range">
        <input
          aria-label={t("filter.rangeMinAria", { label })}
          className="text-field"
          min="0"
          onChange={(event) =>
            setRange((current) => ({ ...current, min: event.target.value }))
          }
          placeholder={t("common.min")}
          step={step}
          type="number"
          value={range.min}
        />
        <span>–</span>
        <input
          aria-label={t("filter.rangeMaxAria", { label })}
          className="text-field"
          min="0"
          onChange={(event) =>
            setRange((current) => ({ ...current, max: event.target.value }))
          }
          placeholder={t("common.max")}
          step={step}
          type="number"
          value={range.max}
        />
      </div>
      <span>
        <input
          aria-label={t("filter.excludeRange", { label })}
          checked={range.exclude}
          disabled={!range.min && !range.max}
          onChange={(event) =>
            setRange((current) => ({
              ...current,
              exclude: event.target.checked,
            }))
          }
          type="checkbox"
        />
        {t("filter.exclude")}
      </span>
    </label>
  );
}
