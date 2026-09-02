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
  togglePresetRanges,
  type RangeStrings,
} from "./filter-presets";
import {
  applyDimensionSelectionClick,
  formatGroupSelectionState,
  formatTokensHas,
  toggleFormatGroup,
  toggleFormatToken,
} from "./dimension-filter-selection";
import {
  FORMAT_FILTER_GROUPS,
  OTHER_FORMAT_EXTENSIONS,
  FORMAT_TEXT_TOKEN,
} from "./format-filter-presets";
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
import { PortaledPopover } from "./PortaledPopover";
import {
  attachCompositionLock,
  shouldHoldDismissForIme,
} from "./ime-safe-dismiss";

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

const HOVER_OPEN_DELAY_MS = 500;
const HOVER_CLOSE_DELAY_MS = 150;
const EMPTY_RANGE: RangeState = { min: "", max: "", exclude: false };

export type DimensionFilterBarProps = {
  disabled?: boolean;
  /**
   * Serpent-0rk: highest-layer modal is open — do not open hover popovers or
   * accept pointer interaction even if buttons are not `disabled`.
   */
  interactionsLocked?: boolean;
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
  /** Selected shape/aspect ranges (OR). Empty → use aspectRatioRange alone. */
  aspectRatioRanges: readonly RangeStrings[];
  setAspectRatioRanges: Dispatch<SetStateAction<RangeStrings[]>>;
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
  shuffleActive?: boolean;
  onShuffle?: () => void;
  onClearFilter: (id: ClearableFilterId) => void;
};

/** Category checkbox with native indeterminate for partial format selection. */
function FormatGroupCheckbox({
  checked,
  indeterminate,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);
  return (
    <label className="format-filter-group-check">
      <input
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        ref={inputRef}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

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
  /** REQ-FILTER-024 / Serpent-jfi: exclude mode uses --filter-exclude (muted in dark). */
  excluding?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={open || undefined}
      aria-pressed={active === undefined ? undefined : active}
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
    interactionsLocked = false,
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
    aspectRatioRanges,
    setAspectRatioRanges,
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
    shuffleActive = false,
    onShuffle,
    onClearFilter,
  } = props;

  const [openDimension, setOpenDimension] = useState<DimensionId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const colorDimRef = useRef<HTMLDivElement>(null);
  const tagsDimRef = useRef<HTMLDivElement>(null);
  const shapeDimRef = useRef<HTMLDivElement>(null);
  const ratingDimRef = useRef<HTMLDivElement>(null);
  const formatDimRef = useRef<HTMLDivElement>(null);
  const moreDimRef = useRef<HTMLDivElement>(null);

  // REQ-FILTER-020: remembers tag names recently applied through this
  // picker so its default (empty-query) view can surface a "recent" section
  // alongside the most-used tags. See tag-filter-recency.ts.
  const [tagRecency, setTagRecency] = useState<TagFilterRecency>(() =>
    loadTagFilterRecency(),
  );

  useEffect(() => {
    if (!openDimension) return;
    const composition = attachCompositionLock();
    const onMouseDown = (event: MouseEvent) => {
      if (composition.isActive()) return;
      const root = rootRef.current;
      if (!root || !(event.target instanceof Element)) return;
      // Portaled popovers live under document.body (MENU-015), so outside-click
      // must treat both the bar and `[data-dimension-filter-popover]` as inside.
      if (root.contains(event.target)) return;
      if (event.target.closest("[data-dimension-filter-popover]")) return;
      setOpenDimension(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldHoldDismissForIme({ composing: composition.isActive(), keyEvent: event })) {
        return;
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpenDimension(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      composition.dispose();
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openDimension]);

  // REQ-FILTER-021: hovering (or keyboard-focusing) a dimension opens its
  // settings popover, independently of the click toggle below. Pointer hover
  // waits briefly before opening so moving across the toolbar does not create
  // a popover on every dimension. Listening at
  // the bar root and matching `[data-dimension]` ancestors (rather than
  // binding per-dimension React handlers that would read a ref during
  // render) keeps this entirely inside an effect, mirroring the existing
  // outside-click-close effect above and hover-tip.tsx's document-listener
  // pattern. A short close delay absorbs the gap between a button and its
  // popover (rendered a few pixels below it) so moving the pointer from one
  // into the other doesn't flicker-close. Portaled popovers sit under body
  // (MENU-015), so pointer/focus leave also treats
  // `[data-dimension-filter-popover]` as still inside the filter chrome.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || disabled || interactionsLocked) {
      setOpenDimension(null);
      return;
    }

    const composition = attachCompositionLock();
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const clearOpenTimer = () => {
      if (openTimer !== null) {
        clearTimeout(openTimer);
        openTimer = null;
      }
    };
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
      clearOpenTimer();
      clearCloseTimer();
      setOpenDimension(id);
    };
    const scheduleOpenForDimensionOf = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const dim = target.closest<HTMLElement>("[data-dimension]");
      const id = dim?.dataset.dimension as DimensionId | undefined;
      if (!id) return;
      clearOpenTimer();
      clearCloseTimer();
      openTimer = setTimeout(() => {
        openTimer = null;
        setOpenDimension(id);
      }, HOVER_OPEN_DELAY_MS);
    };
    const isFilterChrome = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return (
        root.contains(target) ||
        target.closest("[data-dimension-filter-popover]") !== null
      );
    };
    const scheduleClose = () => {
      clearCloseTimer();
      closeTimer = setTimeout(() => setOpenDimension(null), HOVER_CLOSE_DELAY_MS);
    };

    const onPointerOver = (event: PointerEvent) => {
      if (!isFilterChrome(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[data-dimension-filter-popover]")) {
        clearOpenTimer();
        clearCloseTimer();
        return;
      }
      scheduleOpenForDimensionOf(event.target);
      clearCloseTimer();
    };
    const onPointerOut = (event: PointerEvent) => {
      if (!isFilterChrome(event.target)) return;
      if (isFilterChrome(event.relatedTarget)) return;
      // IME candidate HWND is not in-document; relatedTarget is null.
      if (composition.isActive() || event.relatedTarget === null) return;
      scheduleClose();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isFilterChrome(event.target)) return;
      openForDimensionOf(event.target);
      clearCloseTimer();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!isFilterChrome(event.target)) return;
      if (isFilterChrome(event.relatedTarget)) return;
      if (
        shouldHoldDismissForIme({
          composing: composition.isActive(),
          focusEvent: event,
        })
      ) {
        return;
      }
      scheduleClose();
    };

    // Document-level: portaled popovers are outside `root`, so root-only
    // pointerout never sees the leave-from-popover case.
    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      composition.dispose();
      clearOpenTimer();
      clearCloseTimer();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, [disabled, interactionsLocked]);

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
  const shapeToggleRef = useRef(
    new DimensionEnableToggle<{
      range: RangeState;
      presets: RangeStrings[];
    }>(),
  );
  const ratingToggleRef = useRef(
    new DimensionEnableToggle<{ ratingFilter: string; exclude: boolean }>(),
  );
  const formatToggleRef = useRef(
    new DimensionEnableToggle<{ formatFilter: string; exclude: boolean }>(),
  );
  const moreToggleRef = useRef(new DimensionEnableToggle<MoreFilterState>());

  const chips = buildActiveFilterChips(snapshot, {
    textFormatLabel: t("filter.formatText"),
  });
  const controlsDisabled = Boolean(disabled || interactionsLocked);
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
    aspectRatioRanges.length > 0 ||
    aspectRatioRange.min !== "" ||
    aspectRatioRange.max !== "";
  const shapeSelectedRanges: RangeStrings[] =
    aspectRatioRanges.length > 0
      ? [...aspectRatioRanges]
      : aspectRatioRange.min || aspectRatioRange.max
        ? [{ min: aspectRatioRange.min, max: aspectRatioRange.max }]
        : [];
  const applyShapePreset = (range: RangeStrings, shiftKey: boolean) => {
    const next = togglePresetRanges(shapeSelectedRanges, range, shiftKey);
    setAspectRatioRanges(next);
    if (next.length === 1) {
      setAspectRatioRange((current) => ({
        ...current,
        min: next[0]!.min,
        max: next[0]!.max,
      }));
    } else {
      setAspectRatioRange((current) => ({
        ...current,
        min: "",
        max: "",
      }));
    }
  };
  const ratingActive = selectedRatings.size > 0;
  const favoriteActive = favoriteFilter === "yes";
  const formatActive = formatFilter.trim() !== "";
  const otherFormatTokens = [...OTHER_FORMAT_EXTENSIONS, FORMAT_TEXT_TOKEN];
  const otherGroupState = formatGroupSelectionState(
    formatFilter,
    otherFormatTokens,
  );
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
      { range: aspectRatioRange, presets: [...aspectRatioRanges] },
      { range: EMPTY_RANGE, presets: [] },
      (value) => {
        setAspectRatioRange(value.range);
        setAspectRatioRanges(value.presets);
      },
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
        <div className="dimension-filter-dim" data-dimension="color" ref={colorDimRef}>
          <DimensionButton
            active={colorActive}
            disabled={controlsDisabled}
            excluding={excludeColorFilter && colorActive}
            icon="activity"
            label={t("filter.dimColor")}
            onClick={handleColorDimensionClick}
            open={openDimension === "color"}
          />
          {openDimension === "color" && (
            <PortaledPopover
              anchorRef={colorDimRef}
              className="dimension-filter-popover"
              data-dimension="color"
              role="dialog"
            >
              <div className="dimension-color-row" role="listbox" aria-label={t("filter.dimColor")}>
                {COLOR_PRESETS.map((preset) => (
                  <button
                    aria-label={t(`filter.color.${preset.id}`)}
                    aria-selected={selectedColors.has(preset.id)}
                    className={`dimension-color-swatch${selectedColors.has(preset.id) ? " is-active" : ""}${preset.kind === "neutral" ? " is-neutral" : ""}`}
                    data-color={preset.id}
                    disabled={controlsDisabled}
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
            </PortaledPopover>
          )}
        </div>

        <div className="dimension-filter-dim" data-dimension="tags" ref={tagsDimRef}>
          <DimensionButton
            active={tagActive}
            disabled={controlsDisabled}
            excluding={excludeTagFilter && tagActive}
            icon="tag"
            label={t("filter.dimTags")}
            onClick={handleTagsDimensionClick}
            open={openDimension === "tags"}
          />
          {openDimension === "tags" && (
            <PortaledPopover
              anchorRef={tagsDimRef}
              className="dimension-filter-popover"
              data-dimension="tags"
              role="dialog"
            >
              <FilterTagPicker
                disabled={controlsDisabled}
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
            </PortaledPopover>
          )}
        </div>

        <div className="dimension-filter-dim" data-dimension="shape" ref={shapeDimRef}>
          <DimensionButton
            active={shapeActive}
            disabled={controlsDisabled}
            icon="grid"
            label={t("filter.dimShape")}
            onClick={handleShapeDimensionClick}
            open={openDimension === "shape"}
          />
          {openDimension === "shape" && (
            <PortaledPopover
              anchorRef={shapeDimRef}
              className="dimension-filter-popover"
              data-dimension="shape"
              role="dialog"
            >
              <FilterPresetChips
                disabled={controlsDisabled}
                label={t("filter.orientation")}
                onToggle={applyShapePreset}
                presets={ORIENTATION_PRESETS.map((preset) => ({
                  label:
                    preset.id === "landscape"
                      ? t("filter.landscape")
                      : t("filter.portrait"),
                  range: preset.range,
                }))}
                selected={shapeSelectedRanges}
              />
              <FilterPresetChips
                disabled={controlsDisabled}
                label={t("filter.aspectRatioPresets")}
                onToggle={applyShapePreset}
                presets={ASPECT_RATIO_PRESETS.map((preset) => ({
                  label: preset.label,
                  range: aspectRatioPresetRange(preset),
                }))}
                selected={shapeSelectedRanges}
              />
              <TechnicalRangeFilter
                label={t("filter.aspectRatio")}
                range={aspectRatioRange}
                setRange={(next) => {
                  setAspectRatioRange(next);
                  const resolved =
                    typeof next === "function" ? next(aspectRatioRange) : next;
                  setAspectRatioRanges(
                    resolved.min || resolved.max
                      ? [{ min: resolved.min, max: resolved.max }]
                      : [],
                  );
                }}
                step="0.01"
              />
              <p className="dimension-filter-hint">{t("filter.shiftMultiSelectHint")}</p>
            </PortaledPopover>
          )}
        </div>

        <div className="dimension-filter-dim" data-dimension="rating" ref={ratingDimRef}>
          <DimensionButton
            active={ratingActive}
            disabled={controlsDisabled}
            excluding={excludeRatingFilter && ratingActive}
            icon="star"
            label={t("filter.dimRating")}
            onClick={handleRatingDimensionClick}
            open={openDimension === "rating"}
          />
          {openDimension === "rating" && (
            <PortaledPopover
              anchorRef={ratingDimRef}
              className="dimension-filter-popover"
              data-dimension="rating"
              role="dialog"
            >
              <div className="dimension-rating-row" role="group">
                {[5, 4, 3, 2, 1, 0].map((star) => (
                  <button
                    aria-pressed={selectedRatings.has(String(star))}
                    className={`dimension-rating-chip${selectedRatings.has(String(star)) ? " is-active" : ""}`}
                    disabled={controlsDisabled}
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
            </PortaledPopover>
          )}
        </div>

        <div className="dimension-filter-dim">
          <DimensionButton
            active={favoriteActive}
            disabled={controlsDisabled}
            icon="star"
            label={t("filter.favoriteOnly")}
            onClick={() => setFavoriteFilter(favoriteActive ? "any" : "yes")}
          />
        </div>

        <div className="dimension-filter-dim" data-dimension="format" ref={formatDimRef}>
          <DimensionButton
            active={formatActive}
            disabled={controlsDisabled}
            excluding={excludeFormatFilter && formatActive}
            icon="file"
            label={t("filter.dimFormat")}
            onClick={handleFormatDimensionClick}
            open={openDimension === "format"}
          />
          {openDimension === "format" && (
            <PortaledPopover
              anchorRef={formatDimRef}
              className="dimension-filter-popover is-wide format-filter-popover"
              data-dimension="format"
              role="dialog"
            >
              <input
                aria-label={t("filter.format")}
                className="text-field"
                disabled={controlsDisabled}
                onChange={(event) => setFormatFilter(event.target.value)}
                placeholder="png, jpg, mp4"
                value={formatFilter}
              />
              {FORMAT_FILTER_GROUPS.map((group) => {
                const groupState = formatGroupSelectionState(
                  formatFilter,
                  group.extensions,
                );
                return (
                  <div className="format-filter-group" key={group.labelKey}>
                    <FormatGroupCheckbox
                      checked={groupState === "all"}
                      disabled={controlsDisabled}
                      indeterminate={groupState === "partial"}
                      label={t(group.labelKey)}
                      onToggle={() =>
                        setFormatFilter(
                          toggleFormatGroup(formatFilter, group.extensions),
                        )
                      }
                    />
                    <div className="filter-presets" role="group">
                      {group.extensions.map((ext) => {
                        const active = formatTokensHas(formatFilter, ext);
                        return (
                          <button
                            aria-pressed={active}
                            className={`filter-preset-chip${active ? " is-active" : ""}`}
                            disabled={controlsDisabled}
                            key={ext}
                            onClick={(event) =>
                              setFormatFilter(
                                toggleFormatToken(
                                  formatFilter,
                                  ext,
                                  event.shiftKey,
                                ),
                              )
                            }
                            type="button"
                          >
                            {ext}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="format-filter-group">
                <FormatGroupCheckbox
                  checked={otherGroupState === "all"}
                  disabled={controlsDisabled}
                  indeterminate={otherGroupState === "partial"}
                  label={t("filter.formatGroupOther")}
                  onToggle={() =>
                    setFormatFilter(
                      toggleFormatGroup(formatFilter, otherFormatTokens),
                    )
                  }
                />
                <div className="filter-presets" role="group">
                  {otherFormatTokens.map((ext) => {
                    const active = formatTokensHas(formatFilter, ext);
                    return (
                      <button
                        aria-pressed={active}
                        className={`filter-preset-chip${active ? " is-active" : ""}`}
                        disabled={controlsDisabled}
                        key={ext}
                        onClick={(event) =>
                          setFormatFilter(
                            toggleFormatToken(
                              formatFilter,
                              ext,
                              event.shiftKey,
                            ),
                          )
                        }
                        type="button"
                      >
                        {ext === FORMAT_TEXT_TOKEN
                          ? t("filter.formatText")
                          : ext}
                      </button>
                    );
                  })}
                </div>
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
            </PortaledPopover>
          )}
        </div>

        <div className="dimension-filter-dim" data-dimension="more" ref={moreDimRef}>
          <DimensionButton
            active={moreActive}
            disabled={controlsDisabled}
            excluding={excludeAvailabilityFilter && moreActive}
            icon="menu"
            label={t("filter.dimMore")}
            onClick={handleMoreDimensionClick}
            open={openDimension === "more"}
          />
          {openDimension === "more" && (
            <PortaledPopover
              anchorRef={moreDimRef}
              className="dimension-filter-popover is-wide"
              data-dimension="more"
              role="dialog"
            >
              <label>
                {t("filter.favoriteField")}
                <select
                  aria-label={t("filter.favorite")}
                  className="text-field"
                  disabled={controlsDisabled}
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
                  disabled={controlsDisabled}
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
                  disabled={controlsDisabled}
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
                disabled={controlsDisabled}
                label={t("filter.resolutionPresets")}
                onToggle={(range, shiftKey) => {
                  if (shiftKey) {
                    const seed =
                      longEdgeRange.min || longEdgeRange.max
                        ? [
                            {
                              min: longEdgeRange.min,
                              max: longEdgeRange.max,
                            },
                          ]
                        : [];
                    const next = togglePresetRanges(seed, range, true);
                    if (next.length === 1) {
                      setLongEdgeRange((current) => ({
                        ...current,
                        min: next[0]!.min,
                        max: next[0]!.max,
                      }));
                    } else if (next.length === 0) {
                      setLongEdgeRange((current) => ({
                        ...current,
                        min: "",
                        max: "",
                      }));
                    } else {
                      // Resolution still uses a single range in App state;
                      // Shift multi falls back to replace for long-edge.
                      setLongEdgeRange((current) => ({
                        ...current,
                        ...range,
                      }));
                    }
                    return;
                  }
                  setLongEdgeRange((current) => ({
                    ...current,
                    ...togglePresetRange(current, range),
                  }));
                }}
                presets={RESOLUTION_PRESETS}
                selected={
                  longEdgeRange.min || longEdgeRange.max
                    ? [
                        {
                          min: longEdgeRange.min,
                          max: longEdgeRange.max,
                        },
                      ]
                    : []
                }
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
            </PortaledPopover>
          )}
        </div>

        <SortModeControl
          disabled={controlsDisabled}
          onShuffle={onShuffle}
          setSortField={setSortField}
          setSortOrder={setSortOrder}
          shuffleActive={shuffleActive}
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
