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
  applyDimensionSelectionClick,
  formatTokensHas,
  toggleFormatToken,
} from "./dimension-filter-selection";
import { DimensionEnableToggle } from "./dimension-enable-toggle";
import {
  loadTagFilterRecency,
  saveTagFilterRecency,
  withTagFilterUsed,
  type TagFilterRecency,
} from "./tag-filter-recency";
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

/** Bundled "more" popover fields toggled together by REQ-FILTER-021. */
type MoreFilterState = {
  favoriteFilter: "any" | "yes" | "no";
  sourceUrlFilter: "any" | "yes" | "no";
  availabilityFilter: "any" | "available" | "missing";
  excludeAvailabilityFilter: boolean;
  longEdgeRange: RangeState;
  widthRange: RangeState;
  heightRange: RangeState;
  durationRange: RangeState;
};

const HOVER_CLOSE_DELAY_MS = 150;
const EMPTY_RANGE: RangeState = { min: "", max: "", exclude: false };

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
  excluding,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  open?: boolean;
  /** REQ-FILTER-024: exclude mode uses red highlight on the dimension chip. */
  excluding?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={open || undefined}
      aria-pressed={active || undefined}
      className={`dimension-filter-btn${active ? " is-active" : ""}${open ? " is-open" : ""}${excluding ? " is-excluding" : ""}`}
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

  // REQ-FILTER-020: remembers tag names recently applied through this
  // picker so its default (empty-query) view can surface a "recent" section
  // alongside the most-used tags. See tag-filter-recency.ts.
  const [tagRecency, setTagRecency] = useState<TagFilterRecency>(() =>
    loadTagFilterRecency(),
  );

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

  // REQ-FILTER-021: hovering (or keyboard-focusing) a dimension opens its
  // settings popover, independently of the click toggle below. Listening at
  // the bar root and matching `[data-dimension]` ancestors (rather than
  // binding per-dimension React handlers that would read a ref during
  // render) keeps this entirely inside an effect, mirroring the existing
  // outside-click-close effect above and hover-tip.tsx's document-listener
  // pattern. A short close delay absorbs the gap between a button and its
  // popover (rendered a few pixels below it) so moving the pointer from one
  // into the other doesn't flicker-close.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const clearCloseTimer = () => {
      if (closeTimer !== null) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    };
    const openForDimensionOf = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const dim = target.closest<HTMLElement>("[data-dimension]");
      const id = dim?.dataset.dimension as DimensionId | undefined;
      if (!id) return;
      clearCloseTimer();
      setOpenDimension(id);
    };
    const isWithinDimension = (target: EventTarget | null) =>
      target instanceof Element && target.closest("[data-dimension]") !== null;
    const scheduleClose = () => {
      clearCloseTimer();
      closeTimer = setTimeout(() => setOpenDimension(null), HOVER_CLOSE_DELAY_MS);
    };

    const onPointerOver = (event: PointerEvent) =>
      openForDimensionOf(event.target);
    const onPointerOut = (event: PointerEvent) => {
      if (isWithinDimension(event.relatedTarget)) return;
      scheduleClose();
    };
    const onFocusIn = (event: FocusEvent) => openForDimensionOf(event.target);
    const onFocusOut = (event: FocusEvent) => {
      if (isWithinDimension(event.relatedTarget)) return;
      scheduleClose();
    };

    root.addEventListener("pointerover", onPointerOver);
    root.addEventListener("pointerout", onPointerOut);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      clearCloseTimer();
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerout", onPointerOut);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // REQ-FILTER-021: one remembered-value toggle per dimension. Clicking a
  // dimension button clears its live filter value (remembering it) when
  // active, or restores the remembered value when inactive; see
  // dimension-enable-toggle.ts.
  const colorToggleRef = useRef(
    new DimensionEnableToggle<{ colorFilter: string; exclude: boolean }>(),
  );
  const tagsToggleRef = useRef(
    new DimensionEnableToggle<{ names: string[]; exclude: boolean }>(),
  );
  const shapeToggleRef = useRef(new DimensionEnableToggle<RangeState>());
  const ratingToggleRef = useRef(
    new DimensionEnableToggle<{ ratingFilter: string; exclude: boolean }>(),
  );
  const formatToggleRef = useRef(
    new DimensionEnableToggle<{ formatFilter: string; exclude: boolean }>(),
  );
  const moreToggleRef = useRef(new DimensionEnableToggle<MoreFilterState>());

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

  // REQ-FILTER-025: default click covers the dimension's selection with just
  // the clicked value; Shift+click OR-accumulates it. See
  // dimension-filter-selection.ts for the shared resolver.
  const toggleRating = (star: number, shiftKey: boolean) => {
    const key = String(star);
    const next = applyDimensionSelectionClick([...selectedRatings], key, shiftKey);
    setRatingFilter(next.sort().join(", "));
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

  const toggleColor = (id: ColorPresetId, shiftKey: boolean) => {
    const next = applyDimensionSelectionClick(
      [...selectedColors],
      id,
      shiftKey,
    );
    setColorFilter(next.join(", "));
  };

  // REQ-FILTER-021: click toggles a dimension's filter on/off, remembering
  // the cleared value so a second click restores it (hover, wired via the
  // pointer/focus effect above, opens the settings popover instead).
  const handleColorDimensionClick = () => {
    colorToggleRef.current.toggle(
      colorActive,
      { colorFilter, exclude: excludeColorFilter },
      { colorFilter: "", exclude: false },
      (value) => {
        setColorFilter(value.colorFilter);
        setExcludeColorFilter(value.exclude);
      },
    );
  };

  // REQ-FILTER-020: record newly-added tag names into the recency store
  // before forwarding to the caller's onTagNamesChange. Only additions are
  // recorded — removing a tag from the selection should not affect its
  // recency (it may still be worth surfacing again next time).
  const handleTagNamesChange = (names: string[]) => {
    const added = names.filter((name) => !selectedTagNames.includes(name));
    if (added.length > 0) {
      setTagRecency((current) => {
        const next = added.reduce(
          (acc, name) => withTagFilterUsed(acc, name),
          current,
        );
        saveTagFilterRecency(next);
        return next;
      });
    }
    onTagNamesChange(names);
  };

  const handleTagsDimensionClick = () => {
    tagsToggleRef.current.toggle(
      tagActive,
      { names: selectedTagNames, exclude: excludeTagFilter },
      { names: [], exclude: false },
      (value) => {
        onTagNamesChange(value.names);
        setExcludeTagFilter(value.exclude);
      },
    );
  };

  const handleShapeDimensionClick = () => {
    shapeToggleRef.current.toggle(
      shapeActive,
      aspectRatioRange,
      EMPTY_RANGE,
      setAspectRatioRange,
    );
  };

  const handleRatingDimensionClick = () => {
    ratingToggleRef.current.toggle(
      ratingActive,
      { ratingFilter, exclude: excludeRatingFilter },
      { ratingFilter: "", exclude: false },
      (value) => {
        setRatingFilter(value.ratingFilter);
        setExcludeRatingFilter(value.exclude);
      },
    );
  };

  const handleFormatDimensionClick = () => {
    formatToggleRef.current.toggle(
      formatActive,
      { formatFilter, exclude: excludeFormatFilter },
      { formatFilter: "", exclude: false },
      (value) => {
        setFormatFilter(value.formatFilter);
        setExcludeFormatFilter(value.exclude);
      },
    );
  };

  const handleMoreDimensionClick = () => {
    moreToggleRef.current.toggle(
      moreActive,
      {
        favoriteFilter,
        sourceUrlFilter,
        availabilityFilter,
        excludeAvailabilityFilter,
        longEdgeRange,
        widthRange,
        heightRange,
        durationRange,
      },
      {
        favoriteFilter: "any",
        sourceUrlFilter: "any",
        availabilityFilter: "any",
        excludeAvailabilityFilter: false,
        longEdgeRange: EMPTY_RANGE,
        widthRange: EMPTY_RANGE,
        heightRange: EMPTY_RANGE,
        durationRange: EMPTY_RANGE,
      },
      (value) => {
        setFavoriteFilter(value.favoriteFilter);
        setSourceUrlFilter(value.sourceUrlFilter);
        setAvailabilityFilter(value.availabilityFilter);
        setExcludeAvailabilityFilter(value.excludeAvailabilityFilter);
        setLongEdgeRange(value.longEdgeRange);
        setWidthRange(value.widthRange);
        setHeightRange(value.heightRange);
        setDurationRange(value.durationRange);
      },
    );
  };

  return (
    <div className="dimension-filter-bar" ref={rootRef}>
      <div className="dimension-filter-dims" role="toolbar" aria-label={t("filter.dimensions")}>
        <div className="dimension-filter-dim" data-dimension="color">
          <DimensionButton
            active={colorActive}
            disabled={disabled}
            excluding={excludeColorFilter && colorActive}
            icon="activity"
            label={t("filter.dimColor")}
            onClick={handleColorDimensionClick}
            open={openDimension === "color"}
          />
          {openDimension === "color" && (
            <div className="dimension-filter-popover">
              <div className="dimension-color-row" role="listbox" aria-label={t("filter.dimColor")}>
                {COLOR_PRESETS.map((preset) => (
                  <button
                    aria-label={t(`filter.color.${preset.id}`)}
                    aria-selected={selectedColors.has(preset.id)}
                    className={`dimension-color-swatch${selectedColors.has(preset.id) ? " is-active" : ""}${preset.kind === "neutral" ? " is-neutral" : ""}`}
                    data-color={preset.id}
                    disabled={disabled}
                    key={preset.id}
                    onClick={(event) => toggleColor(preset.id, event.shiftKey)}
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
              <p className="dimension-filter-hint">{t("filter.shiftMultiSelectHint")}</p>
            </div>
          )}
        </div>

        <div className="dimension-filter-dim" data-dimension="tags">
          <DimensionButton
            active={tagActive}
            disabled={disabled}
            excluding={excludeTagFilter && tagActive}
            icon="tag"
            label={t("filter.dimTags")}
            onClick={handleTagsDimensionClick}
            open={openDimension === "tags"}
          />
          {openDimension === "tags" && (
            <div className="dimension-filter-popover">
              <FilterTagPicker
                disabled={disabled}
                onChange={handleTagNamesChange}
                recentNames={tagRecency.names}
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
              <p className="dimension-filter-hint">{t("filter.shiftMultiSelectHint")}</p>
            </div>
          )}
        </div>

        <div className="dimension-filter-dim" data-dimension="shape">
          <DimensionButton
            active={shapeActive}
            disabled={disabled}
            icon="grid"
            label={t("filter.dimShape")}
            onClick={handleShapeDimensionClick}
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

        <div className="dimension-filter-dim" data-dimension="rating">
          <DimensionButton
            active={ratingActive}
            disabled={disabled}
            excluding={excludeRatingFilter && ratingActive}
            icon="star"
            label={t("filter.dimRating")}
            onClick={handleRatingDimensionClick}
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
                    onClick={(event) => toggleRating(star, event.shiftKey)}
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
              <p className="dimension-filter-hint">{t("filter.shiftMultiSelectHint")}</p>
            </div>
          )}
        </div>

        <div className="dimension-filter-dim" data-dimension="format">
          <DimensionButton
            active={formatActive}
            disabled={disabled}
            excluding={excludeFormatFilter && formatActive}
            icon="file"
            label={t("filter.dimFormat")}
            onClick={handleFormatDimensionClick}
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
                  const active = formatTokensHas(formatFilter, ext);
                  return (
                    <button
                      aria-pressed={active}
                      className={`filter-preset-chip${active ? " is-active" : ""}`}
                      disabled={disabled}
                      key={ext}
                      onClick={(event) =>
                        setFormatFilter(
                          toggleFormatToken(formatFilter, ext, event.shiftKey),
                        )
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
              <p className="dimension-filter-hint">{t("filter.shiftMultiSelectHint")}</p>
            </div>
          )}
        </div>

        <div className="dimension-filter-dim" data-dimension="more">
          <DimensionButton
            active={moreActive}
            disabled={disabled}
            excluding={excludeAvailabilityFilter && moreActive}
            icon="menu"
            label={t("filter.dimMore")}
            onClick={handleMoreDimensionClick}
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

