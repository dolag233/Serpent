/**
 * 3D viewer toolbar (spec 3.5 minimal toolbar: 重置视角 / HDRI 环境切换 /
 * 统计开关 / 全屏；3D-09 HDRI 切换带缩略图, 光照强度可调).
 *
 * Rendered as a floating chrome chip row at the bottom of the viewport (same
 * `preview-chrome-fade` behavior as the other viewer chrome). All state lives
 * in the surface; this component is pure presentation.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../i18n';
import { Icon } from '../Icons';
import { LIGHT_INTENSITY_MAX, LIGHT_INTENSITY_MIN } from './light-intensity';
import {
  HDRI_PRESETS,
  resolveHdriPreviewUrl,
  type HdriPresetId,
} from './hdri-presets';
import { MODEL_DISPLAY_MODES, type ModelDisplayMode } from './model-display-mode';
import { formatByteSize, formatCount, type ModelStats } from './model-stats';

export interface ModelViewerToolbarProps {
  readonly presetId: HdriPresetId;
  readonly lightIntensity: number;
  readonly displayMode: ModelDisplayMode;
  readonly statsVisible: boolean;
  readonly isFullscreen: boolean;
  onPresetChange(presetId: HdriPresetId): void;
  onLightIntensityChange(intensity: number): void;
  onDisplayModeChange(mode: ModelDisplayMode): void;
  onToggleStats(): void;
  onResetView(): void;
  onFullscreen(): void;
}

export function ModelViewerToolbar(props: ModelViewerToolbarProps) {
  const { locale, t } = useLocale();
  const [hdriOpen, setHdriOpen] = useState(false);
  const hdriPickerRef = useRef<HTMLDivElement>(null);

  // Close the HDRI picker on outside pointer-down / Escape.
  useEffect(() => {
    if (!hdriOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (hdriPickerRef.current?.contains(event.target as Node)) return;
      setHdriOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setHdriOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [hdriOpen]);

  const activePreset =
    HDRI_PRESETS.find((preset) => preset.id === props.presetId) ?? null;
  const activePreview =
    activePreset === null ? null : resolveHdriPreviewUrl(activePreset);

  return (
    <div className="model-viewer-toolbar preview-chrome-fade">
      <div className="model-viewer-toolbar-item is-hdri" ref={hdriPickerRef}>
        <span className="model-viewer-toolbar-label">{t('viewer3d.hdri')}</span>
        <button
          aria-expanded={hdriOpen}
          aria-haspopup="listbox"
          aria-label={t('viewer3d.hdri')}
          className="model-viewer-hdri-trigger"
          onClick={() => setHdriOpen((open) => !open)}
          tabIndex={0}
          type="button"
        >
          {activePreview !== null ? (
            <img alt="" className="model-viewer-hdri-trigger-thumb" src={activePreview} />
          ) : null}
          <span>{activePreset?.displayName[locale] ?? t('viewer3d.hdri')}</span>
          <Icon name="chevron" size={12} />
        </button>
        {hdriOpen ? (
          <div className="model-viewer-hdri-picker" role="listbox">
            {HDRI_PRESETS.map((preset) => {
              const preview = resolveHdriPreviewUrl(preset);
              const selected = preset.id === props.presetId;
              return (
                <button
                  aria-selected={selected}
                  className={`model-viewer-hdri-option${selected ? ' is-active' : ''}`}
                  key={preset.id}
                  onClick={() => {
                    props.onPresetChange(preset.id);
                    setHdriOpen(false);
                  }}
                  role="option"
                  tabIndex={0}
                  type="button"
                >
                  {preview !== null ? (
                    <img alt="" className="model-viewer-hdri-option-thumb" src={preview} />
                  ) : null}
                  <span className="model-viewer-hdri-option-name">
                    {preset.displayName[locale]}
                  </span>
                </button>
              );
            })}
            <div className="model-viewer-hdri-custom-note">{t('viewer3d.hdriCustom')}</div>
          </div>
        ) : null}
      </div>
      <label className="model-viewer-toolbar-item is-display-mode">
        <span className="model-viewer-toolbar-label">{t('viewer3d.displayMode')}</span>
        <select
          aria-label={t('viewer3d.displayMode')}
          value={props.displayMode}
          onChange={(event) => {
            const value = event.currentTarget.value as ModelDisplayMode;
            if (value !== props.displayMode) props.onDisplayModeChange(value);
          }}
          tabIndex={0}
        >
          {MODEL_DISPLAY_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(`viewer3d.displayModes.${mode}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="model-viewer-toolbar-item is-light-intensity">
        <span className="model-viewer-toolbar-label">{t('viewer3d.lightIntensity')}</span>
        <input
          aria-label={t('viewer3d.lightIntensity')}
          max={LIGHT_INTENSITY_MAX}
          min={LIGHT_INTENSITY_MIN}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            if (Number.isFinite(value)) props.onLightIntensityChange(value);
          }}
          step={0.05}
          tabIndex={0}
          type="range"
          value={props.lightIntensity}
        />
        <span className="model-viewer-toolbar-value">
          {props.lightIntensity.toFixed(2)}
        </span>
      </label>
      <button
        aria-label={t('viewer3d.resetView')}
        className="model-viewer-toolbar-button"
        onClick={props.onResetView}
        tabIndex={0}
        title={t('viewer3d.resetView')}
        type="button"
      >
        <Icon name="fit-window" size={16} />
      </button>
      <button
        aria-label={t('viewer3d.toggleStats')}
        aria-pressed={props.statsVisible}
        className={`model-viewer-toolbar-button${props.statsVisible ? ' is-active' : ''}`}
        onClick={props.onToggleStats}
        tabIndex={0}
        title={t('viewer3d.toggleStats')}
        type="button"
      >
        <Icon name="info" size={16} />
      </button>
      <button
        aria-label={
          props.isFullscreen ? t('preview.exitFullscreen') : t('preview.fullscreen')
        }
        className="model-viewer-toolbar-button"
        onClick={props.onFullscreen}
        tabIndex={0}
        title={props.isFullscreen ? t('preview.exitFullscreen') : t('preview.fullscreen')}
        type="button"
      >
        <Icon name={props.isFullscreen ? 'fullscreen-exit' : 'fullscreen'} size={16} />
      </button>
    </div>
  );
}

/** Stats readout (3D-13): 三角面/顶点/材质数/贴图数/文件大小, viewport corner. */
export interface ModelViewerStatsOverlayProps {
  readonly stats: ModelStats;
  readonly byteSize: number;
  readonly locale: string;
}

export function ModelViewerStatsOverlay(props: ModelViewerStatsOverlayProps) {
  const { t } = useLocale();
  return (
    <dl className="model-viewer-stats" aria-label={t('viewer3d.statsAria')}>
      <div>
        <dt>{t('viewer3d.stats.triangles')}</dt>
        <dd>{formatCount(props.stats.triangles, props.locale)}</dd>
      </div>
      <div>
        <dt>{t('viewer3d.stats.vertices')}</dt>
        <dd>{formatCount(props.stats.vertices, props.locale)}</dd>
      </div>
      <div>
        <dt>{t('viewer3d.stats.materials')}</dt>
        <dd>{formatCount(props.stats.materials, props.locale)}</dd>
      </div>
      <div>
        <dt>{t('viewer3d.stats.textures')}</dt>
        <dd>{formatCount(props.stats.textures, props.locale)}</dd>
      </div>
      <div>
        <dt>{t('viewer3d.stats.fileSize')}</dt>
        <dd>{formatByteSize(props.byteSize)}</dd>
      </div>
    </dl>
  );
}
