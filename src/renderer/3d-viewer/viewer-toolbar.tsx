/**
 * 3D viewer toolbar (spec 3.5 minimal toolbar: 重置视角 / HDRI 环境切换 /
 * 统计开关 / 全屏；3D-09 HDRI 切换, 3D-10 曝光可调).
 *
 * Rendered as a floating chrome chip row (same `preview-chrome-fade`
 * behavior as the other viewer chrome). All state lives in the surface; this
 * component is pure presentation.
 */

import { useLocale } from '../i18n';
import { Icon } from '../Icons';
import { EXPOSURE_MAX, EXPOSURE_MIN } from './exposure';
import { HDRI_PRESETS, type HdriPresetId } from './hdri-presets';
import { formatByteSize, formatCount, type ModelStats } from './model-stats';

export interface ModelViewerToolbarProps {
  readonly presetId: HdriPresetId;
  readonly exposure: number;
  readonly statsVisible: boolean;
  readonly isFullscreen: boolean;
  onPresetChange(presetId: HdriPresetId): void;
  onExposureChange(exposure: number): void;
  onToggleStats(): void;
  onResetView(): void;
  onFullscreen(): void;
}

export function ModelViewerToolbar(props: ModelViewerToolbarProps) {
  const { locale, t } = useLocale();
  return (
    <div className="model-viewer-toolbar preview-chrome-fade">
      <label className="model-viewer-toolbar-item is-hdri">
        <span className="model-viewer-toolbar-label">{t('viewer3d.hdri')}</span>
        <select
          aria-label={t('viewer3d.hdri')}
          value={props.presetId}
          onChange={(event) => {
            const value = event.currentTarget.value as HdriPresetId;
            if (value !== props.presetId) props.onPresetChange(value);
          }}
          tabIndex={0}
        >
          {HDRI_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.displayName[locale]}
            </option>
          ))}
          <option value="custom" disabled>
            {t('viewer3d.hdriCustom')}
          </option>
        </select>
      </label>
      <label className="model-viewer-toolbar-item is-exposure">
        <span className="model-viewer-toolbar-label">{t('viewer3d.exposure')}</span>
        <input
          aria-label={t('viewer3d.exposure')}
          max={EXPOSURE_MAX}
          min={EXPOSURE_MIN}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            if (Number.isFinite(value)) props.onExposureChange(value);
          }}
          step={0.05}
          tabIndex={0}
          type="range"
          value={props.exposure}
        />
        <span className="model-viewer-toolbar-value">
          {props.exposure.toFixed(2)}
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
