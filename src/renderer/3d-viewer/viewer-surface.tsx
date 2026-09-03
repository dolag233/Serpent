/**
 * ModelViewerSurface — the interactive 3D viewport (slice C, Serpent-qvc6).
 *
 * Spec coverage: 3D-01 orbit controls (LMB rotate / wheel zoom / RMB pan /
 * dblclick reset, damping), 3D-02 auto-fit on open, 3D-03 polar + distance
 * clamps, 3D-06 theme background (scene.background follows the app theme,
 * environment is independent), 3D-07 soft ground contact shadow,
 * 3D-08 antialias + setPixelRatio(min(dpr,2)), 3D-09 HDRI presets switchable
 * from the toolbar, 3D-10 exposure, 3D-11/12 PBR + companion texture
 * remapping (via loader-registry), 3D-13 stats overlay, 3D-14 observational
 * complexity warnings, 3D-15 error states with retry.
 *
 * WebGL lifecycle: renderer/controls/environment/model are created inside the
 * mount effect and fully disposed on unmount; a `loadEpoch` state re-runs the
 * whole effect for retry. `webglcontextlost` is intercepted and surfaced as
 * an error with a reload action (research §4.7).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Box3,
  Color,
  MOUSE,
  PCFSoftShadowMap,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { AssetSummary } from '../../shared/asset-types';
import type { FbxConvertErrorCode } from '../../shared/fbx-conversion';
import type { SerpentLibraryApi } from '../../shared/library-api';
import { useLocale } from '../i18n';
import { useTheme } from '../theme';
import {
  computeCameraPlacement,
  computeOrbitConstraints,
  sphereFromBounds,
} from './camera-policy';
import {
  fbxErrorI18nKey,
  isFbxErrorCode,
  modelViewerErrorI18nKey,
  type ModelViewerErrorCode,
} from './error-messages';
import { loadHdrEnvironment, type EnvironmentHandle } from './environment';
import {
  environmentYawDelta,
  startsEnvironmentRotation,
} from './environment-rotation-gesture';
import { clampLightIntensity } from './light-intensity';
import { DEFAULT_DISPLAY_MODE, type ModelDisplayMode } from './model-display-mode';
import { setupGroundShadow } from './ground-shadow';
import { getHdriPreset, type HdriPresetId } from './hdri-presets';
import {
  checkModelRenderWarnings,
  type ModelRenderWarning,
} from './limits';
import {
  loadModelScene,
  modelFormatForExtension,
  type LoadedModelScene,
} from './loader-registry';
import { countSceneStats, type ModelStats } from './model-stats';
import { stlDefaultMaterial } from './pbr-mapping';
import { createSceneComposer, type SceneComposer } from './scene-composer';
import {
  loadViewer3dPreferences,
  saveViewer3dPreferences,
} from './viewer-preferences';
import { ModelViewerStatsOverlay, ModelViewerToolbar } from './viewer-toolbar';
import './viewer-surface.css';

export interface ModelViewerSurfaceProps {
  readonly api: SerpentLibraryApi;
  readonly asset: AssetSummary;
  readonly libraryId: string;
  /** `serpent://source/...` URL of the model asset. */
  readonly sourceUrl: string;
  readonly isFullscreen: boolean;
  /** Preloaded navigation surfaces only need one decoded frame. */
  readonly preloadOnly?: boolean;
  onFullscreen(): void;
  onPresentationReady?(): void;
  /** Emit non-blocking load notices into the shell Info stack (MODEL-004). */
  onInfoNotice?(message: string): void;
}

type ViewPhase = 'loading' | 'ready' | 'error';

interface ViewError {
  readonly code: ModelViewerErrorCode | FbxConvertErrorCode;
}

export function ModelViewerSurface(props: ModelViewerSurfaceProps) {
  const { locale, t } = useLocale();
  const { resolved: themeMode, themeRevision } = useTheme();
  const onInfoNotice = props.onInfoNotice;
  const onPresentationReady = props.onPresentationReady;
  const containerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<ViewPhase>('loading');
  const [viewError, setViewError] = useState<ViewError | null>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [statsVisible, setStatsVisible] = useState(false);
  const [warnings, setWarnings] = useState<ModelRenderWarning[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [loadEpoch, setLoadEpoch] = useState(0);
  const [preferences, setPreferences] = useState(() =>
    loadViewer3dPreferences(
      typeof window !== 'undefined' ? window.localStorage : undefined,
    ),
  );

  // Effect-owned handles (refs, not state — no re-renders).
  const composerRef = useRef<SceneComposer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const environmentRef = useRef<EnvironmentHandle | null>(null);
  const environmentDragRef = useRef<{ pointerId: number; lastX: number } | null>(null);
  const preloadOnlyRef = useRef(Boolean(props.preloadOnly));
  const renderFrameRef = useRef<(() => void) | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Promotion changes visibility, not the WebGL session. A preloaded model
  // already has its scene and first paint; changing preloadOnly must only
  // start/stop the render loop instead of disposing and reloading everything.
  useEffect(() => {
    preloadOnlyRef.current = Boolean(props.preloadOnly);
    if (props.preloadOnly) {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }
    if (renderFrameRef.current && animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(renderFrameRef.current);
    }
  }, [props.preloadOnly]);

  const presetId = preferences.presetId;
  const lightIntensity = preferences.lightIntensity;
  const [environmentYaw, setEnvironmentYaw] = useState(0);
  const [displayMode, setDisplayMode] = useState<ModelDisplayMode>(
    preferences.displayMode ?? DEFAULT_DISPLAY_MODE,
  );

  const persistPreferences = useCallback((next: typeof preferences) => {
    setPreferences(next);
    saveViewer3dPreferences(next, window.localStorage);
  }, []);

  const handleLightIntensityChange = useCallback(
    (value: number) => {
      persistPreferences({ ...preferences, lightIntensity: clampLightIntensity(value) });
    },
    [persistPreferences, preferences],
  );

  const handlePresetChange = useCallback(
    (next: HdriPresetId) => {
      persistPreferences({ ...preferences, presetId: next });
    },
    [persistPreferences, preferences],
  );

  const handleDisplayModeChange = useCallback(
    (mode: ModelDisplayMode) => {
      setDisplayMode(mode);
      persistPreferences({ ...preferences, displayMode: mode });
    },
    [persistPreferences, preferences],
  );

  /** Read the effective app background from the theme tokens (3D-06). */
  const applyThemeBackground = useCallback(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--ui-surface-canvas')
      .trim();
    const color = /^#[0-9a-f]{3,8}$/iu.test(raw) ? new Color(raw) : new Color(0x252729);
    composer.setBackground(color);
  }, []);

  // Main mount effect: renderer → composer → controls → companions → model.
  // Deliberately keyed on `loadEpoch` only: the whole pipeline is a single
  // transaction that re-runs on retry; asset/libraryId/sourceUrl are stable
  // for the lifetime of a mount (the modal remounts per asset).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const resizeObserver = new ResizeObserver(() => {
      const composer = composerRef.current;
      if (!composer) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width > 0 && height > 0) composer.resize(width, height);
    });

    setPhase('loading');
    setViewError(null);
    setWarnings([]);
    setNotices([]);
    setStats(null);

    const fail = (code: ModelViewerErrorCode) => {
      setPhase('error');
      setViewError({ code });
    };

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true });
    } catch {
      fail('MODEL_WEBGL_UNAVAILABLE');
      return;
    }
    // 3D-08: explicit antialias + capped DPR for HiDPI displays.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    const composer = createSceneComposer({ renderer });
    composerRef.current = composer;
    container.appendChild(renderer.domElement);
    renderer.domElement.classList.add('model-viewer-canvas');
    resizeObserver.observe(container);

    const camera = composer.camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    // 3D-01: wheel zoom keeps the cursor's world point under the cursor.
    controls.zoomToCursor = true;
    // Right-drag and Ctrl+left-drag rotate the HDRI light source
    // (Serpent-v4jt / Serpent-xjcy), so the right mouse button is not a camera
    // control and Ctrl+left is reserved for the trackpad gesture.
    controls.mouseButtons = {
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: null,
    };
    controlsRef.current = controls;

    const onContextMenu = (event: Event) => event.preventDefault();
    renderer.domElement.addEventListener('contextmenu', onContextMenu);
    const onEnvironmentPointerDown = (event: PointerEvent) => {
      if (!startsEnvironmentRotation(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      environmentDragRef.current = { pointerId: event.pointerId, lastX: event.clientX };
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onEnvironmentPointerMove = (event: PointerEvent) => {
      const drag = environmentDragRef.current;
      if (drag === null || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const deltaYaw = environmentYawDelta(drag.lastX, event.clientX);
      drag.lastX = event.clientX;
      setEnvironmentYaw((current) => current + deltaYaw);
    };
    const onEnvironmentPointerUp = (event: PointerEvent) => {
      const drag = environmentDragRef.current;
      if (drag === null || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      environmentDragRef.current = null;
      renderer.domElement.releasePointerCapture(event.pointerId);
    };
    // Capture-phase listeners run before OrbitControls' bubble listeners,
    // preventing a Ctrl+left gesture from rotating the model at the same time.
    renderer.domElement.addEventListener('pointerdown', onEnvironmentPointerDown, true);
    renderer.domElement.addEventListener('pointermove', onEnvironmentPointerMove, true);
    renderer.domElement.addEventListener('pointerup', onEnvironmentPointerUp, true);
    renderer.domElement.addEventListener('pointercancel', onEnvironmentPointerUp, true);

    const onDoubleClick = () => controls.reset();
    renderer.domElement.addEventListener('dblclick', onDoubleClick);
    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (!cancelled) {
        setPhase('error');
        setViewError({ code: 'MODEL_CONTEXT_LOST' });
      }
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    applyThemeBackground();

    const run = async () => {
      // Companion index for texture remapping (3D-12). A failed lookup
      // degrades to an empty map (materials fall back) instead of failing.
      const companionResult = await props.api.resolveModelCompanions({
        libraryId: props.libraryId,
        assetId: props.asset.assetId,
      });
      const companionMap = new Map(
        companionResult.ok
          ? companionResult.value.map(
              (companion) => [companion.relativeFilePath, companion] as const,
            )
          : [],
      );

      const format = modelFormatForExtension(props.asset.relativeFilePath);
      if (cancelled) return;
      if (!format) {
        fail('MODEL_LOAD_FAILED');
        return;
      }
      let loaded: LoadedModelScene;
      try {
        loaded = await loadModelScene({
          format,
          sourceUrl: props.sourceUrl,
          libraryId: props.libraryId,
          companionMap,
          convertFbx: async () => {
            const result = await props.api.convertModelFbx({
              libraryId: props.libraryId,
              assetId: props.asset.assetId,
            });
            if (!result.ok) {
              // A failed IPC call routes to the FBXLoader fallback like an
              // explicit conversion failure.
              return { status: 'failed', errorCode: 'FBX_CONVERSION_FAILED' };
            }
            return result.value;
          },
          stlMaterial: stlDefaultMaterial(themeMode),
        });
      } catch {
        if (!cancelled) fail('MODEL_LOAD_FAILED');
        return;
      }
      if (cancelled) return;

      const bounds = new Box3().setFromObject(loaded.scene);
      if (bounds.isEmpty()) {
        fail('MODEL_LOAD_FAILED');
        return;
      }
      composer.scene.add(loaded.scene);

      // Auto-fit (3D-02) + orbit constraints (3D-03) + ground shadow (3D-07).
      const sphere = sphereFromBounds({
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
      });
      const width = container.clientWidth;
      const height = container.clientHeight;
      const placement = computeCameraPlacement({
        bounds: sphere,
        viewportAspect: width > 0 && height > 0 ? width / height : 1,
      });
      camera.position.set(...placement.position);
      camera.lookAt(...placement.target);
      controls.target.set(...placement.target);
      const constraints = computeOrbitConstraints({ radius: sphere.radius });
      controls.minPolarAngle = constraints.minPolarAngle;
      controls.maxPolarAngle = constraints.maxPolarAngle;
      controls.minDistance = constraints.minDistance;
      controls.maxDistance = constraints.maxDistance;
      controls.update();
      controls.saveState();

      setupGroundShadow(composer.scene, sphere, bounds.min.y);

      // Stats (3D-13, loaded result is the source of truth) + limits (3D-14).
      const computedStats = countSceneStats(loaded.scene);
      setStats(computedStats);
      setWarnings(
        checkModelRenderWarnings({
          triangles: computedStats.triangles,
          maxTextureEdge: computedStats.maxTextureEdge,
        }),
      );

      const noticeMessages: string[] = [];
      if (loaded.fallback) {
        noticeMessages.push(
          t('viewer3d.notice.fbxFallback', {
            reason: t(fbxErrorI18nKey(loaded.fallback.errorCode)),
          }),
        );
      }
      if (loaded.missingTextures.length > 0) {
        noticeMessages.push(
          t('viewer3d.notice.missingTextures', {
            count: String(loaded.missingTextures.length),
          }),
        );
      }
      if (noticeMessages.length > 0) setNotices(noticeMessages);

      setPhase('ready');

      // Render loop: damping needs continuous frames while orbiting.
      const renderFrame = () => {
        if (cancelled) return;
        animationFrameRef.current = null;
        controls.update();
        composer.renderOnce();
        if (!preloadOnlyRef.current) {
          animationFrameRef.current = requestAnimationFrame(renderFrame);
        }
      };
      renderFrameRef.current = renderFrame;
      // Always paint one frame after the model is ready. A preloaded surface
      // stops here; the promotion effect above resumes the loop if needed.
      renderFrame();
    };

    void run();

    return () => {
      cancelled = true;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      renderFrameRef.current = null;
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      renderer.domElement.removeEventListener('pointerdown', onEnvironmentPointerDown, true);
      renderer.domElement.removeEventListener('pointermove', onEnvironmentPointerMove, true);
      renderer.domElement.removeEventListener('pointerup', onEnvironmentPointerUp, true);
      renderer.domElement.removeEventListener('pointercancel', onEnvironmentPointerUp, true);
      controls.dispose();
      controlsRef.current = null;
      environmentRef.current?.dispose();
      environmentRef.current = null;
      composer.dispose();
      composerRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadEpoch]);

  // Theme background (3D-06): runs after the mount effect so the composer
  // exists; re-applies on theme changes. The mount effect also applies it
  // inline for the first paint.
  useEffect(() => {
    applyThemeBackground();
  }, [applyThemeBackground, themeMode, themeRevision]);

  // Exposure is applied through the composer (and persisted). `loadEpoch`
  // re-applies it after a retry creates a fresh composer.
  useEffect(() => {
    composerRef.current?.setLightIntensity(lightIntensity);
  }, [lightIntensity, loadEpoch]);

  // Right-drag environment rotation (Serpent-v4jt): rotates the light source
  // around the model; re-applied after a retry rebuilds the composer.
  useEffect(() => {
    composerRef.current?.setEnvironmentRotation(environmentYaw);
  }, [environmentYaw, loadEpoch]);

  // Display mode (Serpent-fkhe): applied to the live scene; re-applied after
  // a retry rebuilds the composer.
  useEffect(() => {
    composerRef.current?.setDisplayMode(displayMode);
  }, [displayMode, loadEpoch]);

  // HDRI environment swap (3D-09). The old handle is disposed only after the
  // new one is ready so the view never goes dark between presets. `loadEpoch`
  // re-loads the environment for a fresh composer after retry.
  useEffect(() => {
    let cancelled = false;
    const composer = composerRef.current;
    const preset = getHdriPreset(presetId);
    const url = preset ? `serpent://app-assets/hdri/${preset.fileName}` : null;
    if (!composer || !url) return;
    const previous = environmentRef.current;
    loadHdrEnvironment(url, { renderer: composer.renderer })
      .then((handle) => {
        if (cancelled) {
          handle.dispose();
          return;
        }
        composer.setEnvironment(handle.environmentTexture);
        environmentRef.current = handle;
        previous?.dispose();
      })
      .catch(() => {
        // Environment failure degrades to the fallback light only — the
        // model stays visible (3D-11: not black), surfaced as a notice.
        if (!cancelled) {
          setNotices((current) => [...current, t('viewer3d.notice.hdriFailed')]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [presetId, loadEpoch, t]);

  const resetView = useCallback(() => {
    controlsRef.current?.reset();
  }, []);

  const retry = useCallback(() => {
    setLoadEpoch((epoch) => epoch + 1);
  }, []);

  const effectivePhase: ViewPhase = phase;
  const effectiveError = viewError;

  useEffect(() => {
    if (effectivePhase === 'ready' || effectivePhase === 'error') {
      onPresentationReady?.();
    }
  }, [effectivePhase, onPresentationReady]);

  const errorMessage = effectiveError
    ? t(
        isFbxErrorCode(effectiveError.code)
          ? fbxErrorI18nKey(effectiveError.code)
          : modelViewerErrorI18nKey(effectiveError.code),
      )
    : null;

  // MODEL-004 / Serpent-osr0: route non-blocking notices to the shell Info
  // stack once per message per load, instead of hanging under the viewport.
  const emittedInfoRef = useRef(new Set<string>());
  useEffect(() => {
    emittedInfoRef.current.clear();
  }, [loadEpoch]);
  useEffect(() => {
    if (effectivePhase !== 'ready' || !onInfoNotice) return;
    const messages = [
      ...warnings.map((warning) =>
        warning.code === 'MODEL_TRIANGLES_HIGH'
          ? t('viewer3d.notice.trianglesHigh', {
              count: String(warning.triangles),
              threshold: String(warning.threshold),
            })
          : t('viewer3d.notice.textureHighRes', {
              edge: String(warning.maxEdge),
              limit: String(warning.maxEdgeLimit),
            }),
      ),
      ...notices,
    ];
    for (const message of messages) {
      if (emittedInfoRef.current.has(message)) continue;
      emittedInfoRef.current.add(message);
      onInfoNotice(message);
    }
  }, [effectivePhase, warnings, notices, onInfoNotice, t]);

  return (
    <div
      className="model-viewer-surface"
      ref={containerRef}
      role="region"
      aria-label={t('viewer3d.ariaLabel')}
    >
      {effectivePhase === 'loading' ? (
        <div className="model-viewer-state" role="status">
          <span className="model-viewer-spinner" aria-hidden="true" />
          <span>{t('viewer3d.loading')}</span>
        </div>
      ) : null}
      {effectivePhase === 'error' ? (
        <div className="model-viewer-state is-error" role="alert">
          <strong>{t('viewer3d.errorTitle')}</strong>
          <p>{errorMessage ?? t('viewer3d.error.loadFailed')}</p>
          <button onClick={retry} type="button">
            {t('viewer3d.retry')}
          </button>
        </div>
      ) : null}
      {effectivePhase === 'ready' ? (
        <>
          <ModelViewerToolbar
            displayMode={displayMode}
            lightIntensity={lightIntensity}
            isFullscreen={props.isFullscreen}
            onDisplayModeChange={handleDisplayModeChange}
            onLightIntensityChange={handleLightIntensityChange}
            onFullscreen={props.onFullscreen}
            onPresetChange={handlePresetChange}
            onResetView={resetView}
            onToggleStats={() => setStatsVisible((visible) => !visible)}
            presetId={presetId}
            statsVisible={statsVisible}
          />
          {stats && statsVisible ? (
            <ModelViewerStatsOverlay
              byteSize={props.asset.byteSize}
              locale={locale}
              stats={stats}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
