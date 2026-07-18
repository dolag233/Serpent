import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { Icon, type IconName } from "./Icons";
import { FilterTagPicker } from "./FilterTagPicker";
import { FilterPresetChips } from "./FilterPresetChips";
import {
  ASPECT_RATIO_PRESETS,
  ORIENTATION_PRESETS,
  RESOLUTION_PRESETS,
  aspectRatioPresetRange,
  togglePresetRange,
} from "./filter-presets";
import {
  buildActiveFilterChips,
  type ClearableFilterId,
  type DiscoveryFilterSnapshot,
} from "./active-discovery-filters";
import {
  COLOR_PRESETS,
  parseColorFilterIds,
  type ColorPresetId,
} from "../shared/color-filter-presets";
import { TechnicalRangeFilter } from "./TechnicalRangeFilter";
import { SortModeControl, type SortFieldOption } from "./SortModeControl";
import { useT } from "./i18n";
import type { TagSummary } from "../shared/asset-types";
import type { SortDefinition } from "../shared/asset-types";

export type DimensionId =
  | "color"
  | "tags"
  | "shape"
  | "rating"
  | "format"
  | "more";

type RangeState = { min: string; max: string; exclude: boolean };

export type DimensionFilterBarProps = {
  disabled?: boolean;
  tags: TagSummary[];
  snapshot: DiscoveryFilterSnapshot;
  colorFilter: string;
  setColorFilter: (value: string) => void;
  excludeColorFilter: boolean;
  setExcludeColorFilter: (value: boolean) => void;
  formatFilter: string;
  setFormatFilter: (value: string) => void;
  excludeFormatFilter: boolean;
  setExcludeFormatFilter: (value: boolean) => void;
  tagFilter: string;
  setTagFilter: (value: string) => void;
  excludeTagFilter: boolean;
  setExcludeTagFilter: (value: boolean) => void;
  onTagNamesChange: (names: string[]) => void;
  ratingFilter: string;
  setRatingFilter: (value: string) => void;
  excludeRatingFilter: boolean;
  setExcludeRatingFilter: (value: boolean) => void;
  favoriteFilter: "any" | "yes" | "no";
  setFavoriteFilter: (value: "any" | "yes" | "no") => void;
  sourceUrlFilter: "any" | "yes" | "no";
  setSourceUrlFilter: (value: "any" | "yes" | "no") => void;
  availabilityFilter: "any" | "available" | "missing";
  setAvailabilityFilter: (value: "any" | "available" | "missing") => void;
  excludeAvailabilityFilter: boolean;
  setExcludeAvailabilityFilter: (value: boolean) => void;
  aspectRatioRange: RangeState;
  setAspectRatioRange: Dispatch<SetStateAction<RangeState>>;
  longEdgeRange: RangeState;
  setLongEdgeRange: Dispatch<SetStateAction<RangeState>>;
  widthRange: RangeState;
  setWidthRange: Dispatch<SetStateAction<RangeState>>;
  heightRange: RangeState;
  setHeightRange: Dispatch<SetStateAction<RangeState>>;
  durationRange: RangeState;
  setDurationRange: Dispatch<SetStateAction<RangeState>>;
  sortField: SortFieldOption;
  setSortField: (value: SortFieldOption) => void;
  sortOrder: SortDefinition["order"];
  setSortOrder: (value: SortDefinition["order"]) => void;
  onClearFilter: (id: ClearableFilterId) => void;
};

function DimensionButton({
  icon,
  label,
  active,
  open,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  open?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={open || undefined}
      aria-pressed={active || undefined}
      className={`dimension-filter-btn${active ? " is-active" : ""}${open ? " is-open" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon name={icon} size={14} />
      <span>{label}</span>
    </button>
  );
}

export function DimensionFilterBar(props: DimensionFilterBarProps) {
  const t = useT();
  const {
    disabled,
    tags,
    snapshot,
    colorFilter,
    setColorFilter,
    excludeColorFilter,
    setExcludeColorFilter,
    formatFilter,
    setFormatFilter,
    excludeFormatFilter,
    setExcludeFormatFilter,
    tagFilter,
    excludeTagFilter,
    setExcludeTagFilter,
    onTagNamesChange,
    ratingFilter,
    setRatingFilter,
    excludeRatingFilter,
    setExcludeRatingFilter,
    favoriteFilter,
    setFavoriteFilter,
    sourceUrlFilter,
    setSourceUrlFilter,
    availabilityFilter,
    setAvailabilityFilter,
    excludeAvailabilityFilter,
    setExcludeAvailabilityFilter,
    aspectRatioRange,
    setAspectRatioRange,
    longEdgeRange,
    setLongEdgeRange,
    widthRange,
    setWidthRange,
    heightRange,
    setHeightRange,
    durationRange,
    setDurationRange,
    sortField,
    setSortField,
    sortOrder,
    setSortOrder,
    onClearFilter,
  } = props;

  const [openDimension, setOpenDimension] = useState<DimensionId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openDimension) return;
    const onMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node)) return;
      if (!root.contains(event.target)) setOpenDimension(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpenDimension(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openDimension]);

  const chips = buildActiveFilterChips(snapshot);
  const selectedTagNames = tagFilter
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const selectedRatings = new Set(
    ratingFilter
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const toggleDimension = (id: DimensionId) => {
    setOpenDimension((current) => (current === id ? null : id));
  };

  const toggleRating = (star: number) => {
    const next = new Set(selectedRatings);
    const key = String(star);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setRatingFilter([...next].sort().join(", "));
  };

  const selectedColors = new Set(parseColorFilterIds(colorFilter));
  const tagActive = selectedTagNames.length > 0;
  const colorActive = selectedColors.size > 0;
  const shapeActive =
    aspectRatioRange.min !== "" || aspectRatioRange.max !== "";
  const ratingActive = selectedRatings.size > 0;
  const formatActive = formatFilter.trim() !== "";
  const moreActive =
    favoriteFilter !== "any" ||
    sourceUrlFilter !== "any" ||
    availabilityFilter !== "any" ||
    longEdgeRange.min !== "" ||
    longEdgeRange.max !== "" ||
    widthRange.min !== "" ||
    widthRange.max !== "" ||
    heightRange.min !== "" ||
    heightRange.max !== "" ||
    durationRange.min !== "" ||
    durationRange.max !== "";

  const toggleColor = (id: ColorPresetId) => {
    const next = new Set(selectedColors);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setColorFilter([...next].join(", "));
  };

  return (
    <div className="dimension-filter-bar" ref={rootRef}>
      <div className="dimension-filter-dims" role="toolbar" aria-label={t("filter.dimensions")}>
        <div className="dimension-filter-dim">
          <DimensionButton
            active={colorActive}
            disabled={disabled}
            icon="activity"
            label={t("filter.dimColor")}
            onClick={() => toggleDimension("color")}
            open={openDimension === "color"}
          />
          {openDimension === "color" && (
            <div className="dimension-filter-popover">
              <div className="dimension-color-row" role="listbox" aria-label={t("filter.dimColor")}>
                {COLOR_PRESETS.map((preset) => (
                  <button
                    aria-label={t(`filter.color.${preset.id}`)}
                    aria-selected={selectedColors.has(preset.id)}
                    className={`dimension-color-swatch${selectedColors.has(preset.id) ? " is-active" : ""}`}
                    disabled={disabled}
                    key={preset.id}
                    onClick={() => toggleColor(preset.id)}
                    style={{ background: preset.swatch }}
                    type="button"
                  />
                ))}
              </div>
              <label className="dimension-filter-check">
                <input
                  checked={excludeColorFilter}
                  disabled={disabled || selectedColors.size === 0}
                  onChange={(event) =>
                    setExcludeColorFilter(event.target.checked)
                  }
                  type="checkbox"
                />
                {t("filter.exclude")}
              </label>
            </div>
          )}
        </div>

        <div className="dimension-filter-dim">
          <DimensionButton
            active={tagActive}
            disabled={disabled}
            icon="tag"
            label={t("filter.dimTags")}
            onClick={() => toggleDimension("tags")}
            open={openDimension === "tags"}
          />
          {openDimension === "tags" && (
            <div className="dimension-filter-popover">
              <FilterTagPicker
                disabled={disabled}
                onChange={onTagNamesChange}
                selectedNames={selectedTagNames}
                tags={tags}
              />
              <label className="dimension-filter-check">
                <input
                  checked={excludeTagFilter}
                  disabled={disabled || selectedTagNames.length === 0}
                  onChange={(event) =>
                    setExcludeTagFilter(event.target.checked)
                  }
                  type="checkbox"
                />
                {t("filter.exclude")}
              </label>
            </div>
          )}
        </div>

        <div className="dimension-filter-dim">
          <DimensionButton
            active={shapeActive}
            disabled={disabled}
            icon="grid"
            label={t("filter.dimShape")}
            onClick={() => toggleDimension("shape")}
            open={openDimension === "shape"}
          />
          {openDimension === "shape" && (
            <div className="dimension-filter-popover">
              <FilterPresetChips
                current={aspectRatioRange}
                disabled={disabled}
                label={t("filter.orientation")}
                onToggle={(range) =>
                  setAspectRatioRange((current) => ({
                    ...current,
                    ...togglePresetRange(current, range),
                  }))
                }
                presets={ORIENTATION_PRESETS.map((preset) => ({
                  label:
                    preset.id === "landscape"
                      ? t("filter.landscape")
                      : t("filter.portrait"),
                  range: preset.range,
                }))}
              />
              <FilterPresetChips
                current={aspectRatioRange}
                disabled={disabled}
                label={t("filter.aspectRatioPresets")}
                onToggle={(range) =>
                  setAspectRatioRange((current) => ({
                    ...current,
                    ...togglePresetRange(current, range),
                  }))
                }
                presets={ASPECT_RATIO_PRESETS.map((preset) => ({
                  label: preset.label,
                  range: aspectRatioPresetRange(preset),
                }))}
              />
              <TechnicalRangeFilter
                label={t("filter.aspectRatio")}
                range={aspectRatioRange}
                setRange={setAspectRatioRange}
                step="0.01"
              />
            </div>
          )}
        </div>

        <div className="dimension-filter-dim">
          <DimensionButton
            active={ratingActive}
            disabled={disabled}
            icon="star"
            label={t("filter.dimRating")}
            onClick={() => toggleDimension("rating")}
            open={openDimension === "rating"}
          />
          {openDimension === "rating" && (
            <div className="dimension-filter-popover">
              <div className="dimension-rating-row" role="group">
                {[5, 4, 3, 2, 1, 0].map((star) => (
                  <button
                    aria-pressed={selectedRatings.has(String(star))}
                    className={`dimension-rating-chip${selectedRatings.has(String(star)) ? " is-active" : ""}`}
                    disabled={disabled}
                    key={star}
                    onClick={() => toggleRating(star)}
                    type="button"
                  >
                    {star === 0 ? t("filter.unrated") : `${star}★`}
                  </button>
                ))}
              </div>
              <label className="dimension-filter-check">
                <input
                  checked={excludeRatingFilter}
                  disabled={disabled || selectedRatings.size === 0}
                  onChange={(event) =>
                    setExcludeRatingFilter(event.target.checked)
                  }
                  type="checkbox"
                />
                {t("filter.exclude")}
              </label>
            </div>
          )}
        </div>

        <div className="dimension-filter-dim">
          <DimensionButton
            active={formatActive}
            disabled={disabled}
            icon="file"
            label={t("filter.dimFormat")}
            onClick={() => toggleDimension("format")}
            open={openDimension === "format"}
          />
          {openDimension === "format" && (
            <div className="dimension-filter-popover">
              <input
                aria-label={t("filter.format")}
                className="text-field"
                disabled={disabled}
                onChange={(event) => setFormatFilter(event.target.value)}
                placeholder="png, jpg, mp4"
                value={formatFilter}
              />
              <div className="filter-presets" role="group">
                {["png", "jpg", "webp", "gif", "mp4", "mov"].map((ext) => {
                  const active = selectedFormatsHas(formatFilter, ext);
                  return (
                    <button
                      aria-pressed={active}
                      className={`filter-preset-chip${active ? " is-active" : ""}`}
                      disabled={disabled}
                      key={ext}
                      onClick={() =>
                        setFormatFilter(toggleFormatToken(formatFilter, ext))
                      }
                      type="button"
                    >
                      {ext}
                    </button>
                  );
                })}
              </div>
              <label className="dimension-filter-check">
                <input
                  checked={excludeFormatFilter}
                  disabled={disabled || !formatFilter.trim()}
                  onChange={(event) =>
                    setExcludeFormatFilter(event.target.checked)
                  }
                  type="checkbox"
                />
                {t("filter.exclude")}
              </label>
            </div>
          )}
        </div>

        <div className="dimension-filter-dim">
          <DimensionButton
            active={moreActive}
            disabled={disabled}
            icon="menu"
            label={t("filter.dimMore")}
            onClick={() => toggleDimension("more")}
            open={openDimension === "more"}
          />
          {openDimension === "more" && (
            <div className="dimension-filter-popover is-wide">
              <label>
                {t("filter.favoriteField")}
                <select
                  aria-label={t("filter.favorite")}
                  className="text-field"
                  disabled={disabled}
                  onChange={(event) =>
                    setFavoriteFilter(
                      event.target.value as typeof favoriteFilter,
                    )
                  }
                  value={favoriteFilter}
                >
                  <option value="any">{t("common.none")}</option>
                  <option value="yes">{t("filter.favoriteOnly")}</option>
                  <option value="no">{t("filter.notFavorite")}</option>
                </select>
              </label>
              <label>
                {t("filter.sourceUrlField")}
                <select
                  aria-label={t("filter.sourceUrl")}
                  className="text-field"
                  disabled={disabled}
                  onChange={(event) =>
                    setSourceUrlFilter(
                      event.target.value as typeof sourceUrlFilter,
                    )
                  }
                  value={sourceUrlFilter}
                >
                  <option value="any">{t("common.none")}</option>
                  <option value="yes">{t("filter.hasSourceUrl")}</option>
                  <option value="no">{t("filter.noSourceUrl")}</option>
                </select>
              </label>
              <label>
                {t("filter.availabilityField")}
                <select
                  aria-label={t("filter.availability")}
                  className="text-field"
                  disabled={disabled}
                  onChange={(event) =>
                    setAvailabilityFilter(
                      event.target.value as typeof availabilityFilter,
                    )
                  }
                  value={availabilityFilter}
                >
                  <option value="any">{t("common.all")}</option>
                  <option value="available">{t("filter.available")}</option>
                  <option value="missing">{t("filter.missing")}</option>
                </select>
              </label>
              <label className="dimension-filter-check">
                <input
                  checked={excludeAvailabilityFilter}
                  disabled={disabled || availabilityFilter === "any"}
                  onChange={(event) =>
                    setExcludeAvailabilityFilter(event.target.checked)
                  }
                  type="checkbox"
                />
                {t("filter.exclude")}
              </label>
              <FilterPresetChips
                current={longEdgeRange}
                disabled={disabled}
                label={t("filter.resolutionPresets")}
                onToggle={(range) =>
                  setLongEdgeRange((current) => ({
                    ...current,
                    ...togglePresetRange(current, range),
                  }))
                }
                presets={RESOLUTION_PRESETS}
              />
              <TechnicalRangeFilter
                label={t("filter.longEdgePx")}
                range={longEdgeRange}
                setRange={setLongEdgeRange}
              />
              <TechnicalRangeFilter
                label={t("filter.widthPx")}
                range={widthRange}
                setRange={setWidthRange}
              />
              <TechnicalRangeFilter
                label={t("filter.heightPx")}
                range={heightRange}
                setRange={setHeightRange}
              />
              <TechnicalRangeFilter
                label={t("filter.durationSec")}
                range={durationRange}
                setRange={setDurationRange}
                step="0.1"
              />
            </div>
          )}
        </div>

        <SortModeControl
          disabled={disabled}
          setSortField={setSortField}
          setSortOrder={setSortOrder}
          sortField={sortField}
          sortOrder={sortOrder}
        />
      </div>

      {chips.length > 0 && (
        <div className="dimension-filter-chips" aria-label={t("filter.activeFilters")}>
          {chips.map((chip) => {
            const label = labelForActiveChip(chip.id, t);
            return (
              <button
                className="dimension-active-chip"
                key={chip.id}
                onClick={() => onClearFilter(chip.id as ClearableFilterId)}
                type="button"
                title={t("filter.clearChip")}
              >
                <span>
                  {label}
                  {chip.detail ? ` · ${chip.detail}` : ""}
                </span>
                <Icon name="close" size={10} />
              </button>
            );
          })}
          <button
            className="dimension-active-chip is-clear-all"
            onClick={() => onClearFilter("all")}
            type="button"
          >
            {t("filter.clearAll")}
          </button>
        </div>
      )}
    </div>
  );
}

function labelForActiveChip(id: string, t: ReturnType<typeof useT>): string {
  switch (id) {
    case "color":
      return t("filter.dimColor");
    case "format":
      return t("filter.formatField");
    case "tag":
      return t("filter.tagField");
    case "rating":
      return t("filter.ratingField");
    case "favorite":
      return t("filter.favoriteField");
    case "source_url":
      return t("filter.sourceUrlField");
    case "availability":
      return t("filter.availabilityField");
    case "aspect_ratio":
      return t("filter.aspectRatio");
    case "long_edge":
      return t("filter.longEdgePx");
    case "width":
      return t("filter.widthPx");
    case "height":
      return t("filter.heightPx");
    case "duration":
      return t("filter.durationSec");
    default:
      return id;
  }
}

function selectedFormatsHas(formatFilter: string, ext: string): boolean {
  return formatFilter
    .split(",")
    .map((value) => value.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean)
    .includes(ext.toLowerCase());
}

function toggleFormatToken(formatFilter: string, ext: string): string {
  const tokens = formatFilter
    .split(",")
    .map((value) => value.trim().replace(/^\./, ""))
    .filter(Boolean);
  const lower = ext.toLowerCase();
  const exists = tokens.some((token) => token.toLowerCase() === lower);
  const next = exists
    ? tokens.filter((token) => token.toLowerCase() !== lower)
    : [...tokens, ext];
  return next.join(", ");
}
