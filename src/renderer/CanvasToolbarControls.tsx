import type { ReactNode } from "react";
import {
  type CanvasPreferences,
} from "./canvas-preferences";
import {
  indexOfDiscreteCardSize,
} from "./card-size-stops";
import {
  toolbarCommandRegistry,
  type ToolbarCommandActions,
  type ToolbarCommandContext,
} from "./commands/toolbar-commands";
import type { CommandLocale, CommandPlatform } from "./commands/command-types";
import { Icon, type IconName } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { translateForLocale } from "./i18n";

const FIELD_BUTTONS: readonly {
  readonly id: "canvas.field.name" | "canvas.field.size" | "canvas.field.date";
  readonly field: keyof CanvasPreferences["fields"];
  readonly icon: IconName;
}[] = [
  { id: "canvas.field.name", field: "name", icon: "tag" },
  { id: "canvas.field.size", field: "size", icon: "info" },
  { id: "canvas.field.date", field: "date", icon: "clock" },
];

function ToolButton({
  label,
  icon,
  onClick,
  pressed,
  disabled,
}: {
  label: string;
  icon: IconName;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      aria-pressed={pressed}
      className="tool-button"
      disabled={disabled}
      onClick={onClick}
      type="button"
      {...iconActionAttrs(label)}
    >
      <Icon name={icon} />
    </button>
  );
}

function resolveItem(ctx: ToolbarCommandContext, id: string) {
  const def = toolbarCommandRegistry.get(id);
  if (def === undefined) {
    throw new Error(`Unknown toolbar command: ${id}`);
  }
  const reason =
    def.disabledReason !== undefined ? def.disabledReason(ctx) : null;
  return {
    label: typeof def.title === "function" ? def.title(ctx) : def.title,
    disabled: reason !== null,
    run: () => {
      void def.run(ctx);
    },
  };
}

/** 缩略图滑块不是离散命令；标签仍走同一套 i18n。 */
function translateCardSizeLabel(locale: CommandLocale): string {
  return translateForLocale(locale, "toolbar.thumbnailSize");
}

/**
 * 工作区常驻画布控件。按钮文案/禁用/执行均经 toolbar-commands 注册表，
 * 与后续命令盘/快捷键共用同一份 handler。
 */
export function CanvasToolbarControls({
  libraryOpen,
  busy,
  canvasPrefs,
  cardSize,
  cardSizeStops,
  locale,
  platform,
  actions,
  onCardSizeChange,
}: {
  libraryOpen: boolean;
  busy: boolean;
  canvasPrefs: CanvasPreferences;
  cardSize: number;
  /** Width-aligned discrete stops (Serpent-7ny); slider indexes into these. */
  cardSizeStops: readonly number[];
  locale: CommandLocale;
  platform: CommandPlatform;
  actions: ToolbarCommandActions;
  onCardSizeChange: (size: number) => void;
}): ReactNode {
  const ctx: ToolbarCommandContext = {
    surface: "canvas",
    platform,
    locale,
    selectedAssetIds: [],
    primaryAssetId: null,
    assetScope: "canvas",
    trashMode: false,
    libraryOpen,
    busy,
    viewMode: canvasPrefs.viewMode,
    fields: canvasPrefs.fields,
    actions,
  };

  const refresh = resolveItem(ctx, "canvas.refresh");
  const grid = resolveItem(ctx, "canvas.view.grid");
  const masonry = resolveItem(ctx, "canvas.view.masonry");

  return (
    <span className="tool-group-view">
      <div className="canvas-controls">
        <ToolButton
          disabled={refresh.disabled}
          icon="refresh"
          label={refresh.label}
          onClick={refresh.run}
        />
        <span className="tool-separator" />
        <ToolButton
          icon="grid"
          label={grid.label}
          onClick={grid.run}
          pressed={canvasPrefs.viewMode === "grid"}
        />
        <ToolButton
          icon="menu"
          label={masonry.label}
          onClick={masonry.run}
          pressed={canvasPrefs.viewMode === "masonry"}
        />
        <label className="asset-size-control">
          <input
            aria-label={translateCardSizeLabel(locale)}
            data-hover-tip={translateCardSizeLabel(locale)}
            max={Math.max(0, cardSizeStops.length - 1)}
            min={0}
            onChange={(event) => {
              const index = Number(event.target.value);
              const next = cardSizeStops[index];
              if (typeof next === "number") onCardSizeChange(next);
            }}
            step={1}
            type="range"
            value={indexOfDiscreteCardSize(cardSize, cardSizeStops)}
          />
        </label>
        <span className="tool-separator" />
        {FIELD_BUTTONS.map(({ id, field, icon }) => {
          const item = resolveItem(ctx, id);
          return (
            <ToolButton
              key={field}
              icon={icon}
              label={item.label}
              onClick={item.run}
              pressed={canvasPrefs.fields[field]}
            />
          );
        })}
      </div>
    </span>
  );
}
