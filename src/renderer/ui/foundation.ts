/**
 * Public, framework-agnostic contract for the Renderer UI foundation.
 *
 * This module deliberately contains no React, DOM, or business imports. Later
 * primitives can use these names to stay on the same semantic token and layer
 * vocabulary without coupling their implementation to styles.css.
 */

export type UiTheme = 'dark' | 'light';

export type UiTokenCategory =
  | 'surface'
  | 'background'
  | 'content'
  | 'border'
  | 'action'
  | 'status'
  | 'geometry'
  | 'typography'
  | 'elevation'
  | 'layer';

/** Named stacking layers. Components must choose a layer, not a private z-index. */
export type UiLayerName =
  | 'base'
  | 'shell'
  | 'sticky'
  | 'menu'
  | 'popover'
  | 'activity'
  | 'notice'
  | 'modalBackdrop'
  | 'modal'
  | 'tooltip';

export const UI_LAYER = {
  base: 0,
  shell: 100,
  sticky: 200,
  menu: 300,
  popover: 400,
  activity: 500,
  notice: 600,
  modalBackdrop: 700,
  modal: 800,
  tooltip: 900,
} as const satisfies Record<UiLayerName, number>;

export type UiLayerValue = (typeof UI_LAYER)[UiLayerName];

/** CSS custom properties shared by future primitives and semantic adapters. */
export const UI_CSS_VAR = {
  background: {
    color: '--ui-background-color',
    image: '--ui-background-image',
    imageOpacity: '--ui-background-image-opacity',
    surfaceOpacity: '--ui-background-surface-opacity',
    size: '--ui-background-size',
    position: '--ui-background-position',
    repeat: '--ui-background-repeat',
  },
  surface: {
    canvas: '--ui-surface-canvas',
    pane: '--ui-surface-pane',
    raised: '--ui-surface-raised',
    raisedSubtle: '--ui-surface-raised-subtle',
    overlay: '--ui-surface-overlay',
    scrim: '--ui-surface-scrim',
    hover: '--ui-surface-hover',
    pressed: '--ui-surface-pressed',
    selected: '--ui-surface-selected',
    disabled: '--ui-surface-disabled',
  },
  content: {
    primary: '--ui-content-primary',
    secondary: '--ui-content-secondary',
    tertiary: '--ui-content-tertiary',
    disabled: '--ui-content-disabled',
    inverse: '--ui-content-inverse',
    onAccent: '--ui-content-on-accent',
    accent: '--ui-content-accent',
  },
  border: {
    divider: '--ui-border-divider',
    subtle: '--ui-border-subtle',
    control: '--ui-border-control',
    focus: '--ui-border-focus',
    selection: '--ui-border-selection',
    danger: '--ui-border-danger',
  },
  action: {
    accent: '--ui-action-accent',
    accentHover: '--ui-action-accent-hover',
    accentPressed: '--ui-action-accent-pressed',
    accentSoft: '--ui-action-accent-soft',
    hover: '--ui-action-hover',
    pressed: '--ui-action-pressed',
    selected: '--ui-action-selected',
    disabled: '--ui-action-disabled',
    danger: '--ui-action-danger',
    dangerHover: '--ui-action-danger-hover',
  },
  status: {
    info: '--ui-status-info',
    infoSurface: '--ui-status-info-surface',
    infoContent: '--ui-status-info-content',
    success: '--ui-status-success',
    successSurface: '--ui-status-success-surface',
    successContent: '--ui-status-success-content',
    warning: '--ui-status-warning',
    warningSurface: '--ui-status-warning-surface',
    warningContent: '--ui-status-warning-content',
    danger: '--ui-status-danger',
    dangerSurface: '--ui-status-danger-surface',
    dangerContent: '--ui-status-danger-content',
  },
  geometry: {
    space0: '--ui-space-0',
    space1: '--ui-space-1',
    space2: '--ui-space-2',
    space3: '--ui-space-3',
    space4: '--ui-space-4',
    space5: '--ui-space-5',
    space6: '--ui-space-6',
    space7: '--ui-space-7',
    controlSm: '--ui-size-control-sm',
    controlMd: '--ui-size-control-md',
    controlLg: '--ui-size-control-lg',
    toolbar: '--ui-size-toolbar',
    chip: '--ui-size-chip',
    iconSm: '--ui-size-icon-sm',
    iconMd: '--ui-size-icon-md',
    iconLg: '--ui-size-icon-lg',
    paneGutter: '--ui-gutter-pane',
    gridGutter: '--ui-gutter-grid',
    radiusControl: '--ui-radius-control',
    radiusSurface: '--ui-radius-surface',
    radiusDialog: '--ui-radius-dialog',
    radiusOverlay: '--ui-radius-overlay',
    radiusPill: '--ui-radius-pill',
    borderHairline: '--ui-border-width-hairline',
    borderFocus: '--ui-border-width-focus',
  },
  typography: {
    family: '--ui-font-family',
    familyMono: '--ui-font-family-mono',
    micro: '--ui-font-size-micro',
    caption: '--ui-font-size-caption',
    body: '--ui-font-size-body',
    label: '--ui-font-size-label',
    title: '--ui-font-size-title',
    heading: '--ui-font-size-heading',
    lineTight: '--ui-line-height-tight',
    lineNormal: '--ui-line-height-normal',
    lineRelaxed: '--ui-line-height-relaxed',
    weightRegular: '--ui-font-weight-regular',
    weightMedium: '--ui-font-weight-medium',
    weightSemibold: '--ui-font-weight-semibold',
  },
  elevation: {
    none: '--ui-shadow-none',
    surface: '--ui-shadow-surface',
    popover: '--ui-shadow-popover',
    modal: '--ui-shadow-modal',
    notice: '--ui-shadow-notice',
    controlInset: '--ui-shadow-control-inset',
    controlThumb: '--ui-shadow-control-thumb',
  },
  layer: {
    base: '--ui-layer-base',
    shell: '--ui-layer-shell',
    sticky: '--ui-layer-sticky',
    menu: '--ui-layer-menu',
    popover: '--ui-layer-popover',
    activity: '--ui-layer-activity',
    notice: '--ui-layer-notice',
    modalBackdrop: '--ui-layer-modal-backdrop',
    modal: '--ui-layer-modal',
    tooltip: '--ui-layer-tooltip',
  },
} as const;

type UiCssVariableGroup = (typeof UI_CSS_VAR)[keyof typeof UI_CSS_VAR];

/** Union of every semantic CSS variable value in UI_CSS_VAR. */
export type UiCssVariable = UiCssVariableGroup extends infer Group
  ? Group extends Record<string, infer Value>
    ? Value
    : never
  : never;

export function cssVar(variable: UiCssVariable, fallback?: string): string {
  return fallback === undefined ? `var(${variable})` : `var(${variable}, ${fallback})`;
}

export function layerCssVar(layer: UiLayerName): string {
  return `var(${UI_CSS_VAR.layer[layer]})`;
}
