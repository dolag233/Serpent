import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import {
  clearFontPreviewText,
  loadFontPreviewTexts,
  saveFontPreviewText,
  type FontPreviewTexts,
} from "./font-preview-preferences";
import {
  FONT_PREVIEW_LANGUAGES,
  FONT_VIEWER_MAX_SIZE,
  FONT_VIEWER_MIN_SIZE,
  clampFontViewerText,
  createFontViewerSettings,
  defaultFontViewerText,
  fontViewerSpecimenSizes,
  isFontPreviewLanguage,
  nearestVariableWeight,
  previewLanguageForDeclared,
  stepFontViewerSize,
  variableWeightOptions,
  type FontPreviewLanguage,
  type FontViewerSettings,
} from "./font-viewer-settings";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { FontViewerMenu } from "./font-viewer-menu";
import { useT } from "./i18n";

export type FontViewerSurfaceProps = {
  api: SerpentLibraryApi | null;
  libraryId: string;
  assetId: string;
  /** Resolved `serpent://source/...` URL of the font file. */
  sourceUrl: string;
  isFullscreen: boolean;
  onPresentationReady?: () => void;
};

const FONT_FACE_FAMILY_PREFIX = "SerpentFontViewer";
/** 可变字体的 FontFace 声明一个范围，浏览器才会用 `wght` 轴而不是合成加粗。 */
const VARIABLE_WEIGHT_DESCRIPTOR = "100 900";

/**
 * One family per asset: during a preview navigation transition the outgoing and
 * the preloaded incoming viewer can be mounted at the same time, and a shared
 * family name would make one of them render with the other's font file.
 */
function fontFaceFamilyFor(assetId: string): string {
  return `${FONT_FACE_FAMILY_PREFIX}-${assetId.replaceAll(/[^A-Za-z0-9-]/gu, "")}`;
}

/** i18n key of each preview language's label. */
function languageLabelKey(language: FontPreviewLanguage): string {
  return `fontPreviewLanguage.${language}`;
}

/**
 * Serpent-485aeb: font viewer.
 *
 * The glyphs are rendered by the Renderer itself through a `FontFace` loaded
 * from the `serpent://source` route (a same-scheme request the CSP already
 * allows), so the viewer is plain DOM: language, preview text, size, weight
 * (variable fonts only) and bold/italic/underline are view-only settings,
 * mouse-wheel resizes, and Escape keeps working after the user clicks inside
 * the specimen. Bold/italic are synthesized by the browser (`font-synthesis`)
 * because a single font file normally carries only one weight/slope.
 */
export function FontViewerSurface({
  api,
  libraryId,
  assetId,
  sourceUrl,
  isFullscreen,
  onPresentationReady,
}: FontViewerSurfaceProps) {
  const t = useT();
  const fontFamily = fontFaceFamilyFor(assetId);
  const [settings, setSettings] = useState<FontViewerSettings>(() =>
    createFontViewerSettings("en"),
  );
  // 用户自定义的预览文字按语言持久化（serpent 级别，见 font-preview-preferences）。
  const [customTexts, setCustomTexts] = useState<FontPreviewTexts>(() =>
    loadFontPreviewTexts(),
  );
  const [variableWeights, setVariableWeights] = useState<readonly number[]>([]);
  const [languageTouched, setLanguageTouched] = useState(false);
  // A failure belongs to its source URL so a new source can load normally.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const readyCallbackRef = useRef(onPresentationReady);

  useEffect(() => {
    readyCallbackRef.current = onPresentationReady;
  }, [onPresentationReady]);

  useEffect(() => {
    let cancelled = false;
    let added: FontFace | null = null;
    const face = new FontFace(fontFamily, `url("${sourceUrl}")`, {
      // 变体字体声明范围；静态字体保持 normal 以便浏览器合成加粗。
      weight: variableWeights.length > 0 ? VARIABLE_WEIGHT_DESCRIPTOR : "normal",
    });
    void face
      .load()
      .then((loadedFace) => {
        if (cancelled) return;
        document.fonts.add(loadedFace);
        added = loadedFace;
        readyCallbackRef.current?.();
      })
      .catch(() => {
        if (cancelled) return;
        setFailedUrl(sourceUrl);
        readyCallbackRef.current?.();
      });
    return () => {
      cancelled = true;
      if (added) document.fonts.delete(added);
    };
  }, [fontFamily, sourceUrl, variableWeights.length]);

  // Best-effort: the file's declared language only picks the initial value of
  // the language control (the user's own choice always wins afterwards).
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.getExtractedMetadata({ libraryId, assetId });
        if (cancelled || !result.ok) return;
        const metadata = result.value.metadata;
        if (!metadata) return;
        const declared = previewLanguageForDeclared(metadata.fontLanguage);
        setSettings((current) =>
          languageTouched ? current : { ...current, language: declared },
        );
        const options = variableWeightOptions(metadata.fontVariableWeights);
        setVariableWeights(options);
        const nearest = nearestVariableWeight(
          options,
          metadata.fontWeightClass ?? 400,
        );
        if (nearest !== null) {
          setSettings((current) => ({ ...current, weight: nearest }));
        }
      } catch {
        // Keep the defaults (English sample text).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, assetId, languageTouched, libraryId]);

  // 样张上的滚轮统一改字号：直接滚与 Ctrl/⌘+滚轮效果相同（用户口径）。
  // 必须 preventDefault，否则 Electron 会对 Ctrl+滚轮做整页缩放。
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setSettings((current) => ({
        ...current,
        size: stepFontViewerSize(current.size, event.deltaY),
      }));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const update = useCallback((patch: Partial<FontViewerSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const weightOptions = useMemo(
    () => variableWeightOptions(variableWeights),
    [variableWeights],
  );

  if (failedUrl === sourceUrl) {
    return (
      <div className="html-viewer" data-fullscreen={isFullscreen ? "true" : undefined}>
        <p className="html-viewer-error">{t("viewer.fontPreviewUnavailable")}</p>
      </div>
    );
  }

  const specimenSizes = fontViewerSpecimenSizes(settings.size);
  const customText = customTexts[settings.language];
  const previewText = customText ?? defaultFontViewerText(settings.language);
  const specimenStyle = {
    fontFamily: `"${fontFamily}", system-ui, sans-serif`,
    // 浏览器合成字重/斜体：字体文件通常只有一套字形（用户反馈第 3 条）。
    fontSynthesis: "weight style",
    fontWeight: settings.bold ? "bold" : weightOptions.length > 0 ? settings.weight : "normal",
    fontStyle: settings.italic ? "italic" : "normal",
    textDecoration: settings.underline ? "underline" : "none",
  } as const;

  return (
    <div
      className="html-viewer font-viewer"
      data-fullscreen={isFullscreen ? "true" : undefined}
    >
      <div className="font-viewer-stage" ref={stageRef}>
        <div className="font-viewer-specimen">
          {specimenSizes.map((size, index) => (
            <div
              className="font-viewer-specimen-row"
              data-row={index}
              dir="auto"
              key={index}
              style={{ ...specimenStyle, fontSize: `${size}px` }}
            >
              {previewText}
            </div>
          ))}
        </div>
      </div>
      <div
        aria-label={t("viewer.fontPreview")}
        className="preview-zoom-controls preview-chrome-fade is-approach-toolbar font-viewer-controls"
      >
        <label
          className="font-viewer-control font-viewer-control-text"
          data-hover-tip={t("viewer.fontPreviewText")}
        >
          <Icon name="type" size={14} />
          <input
            aria-label={t("viewer.fontPreviewText")}
            className="font-viewer-text-input"
            maxLength={120}
            onChange={(event) => {
              const text = clampFontViewerText(event.currentTarget.value);
              setCustomTexts(
                saveFontPreviewText(settings.language, text, localStorage, customTexts),
              );
            }}
            type="text"
            value={previewText}
          />
        </label>
        <button
          className="font-viewer-text-reset"
          disabled={customText === undefined}
          onClick={() => {
            setCustomTexts(
              clearFontPreviewText(settings.language, localStorage, customTexts),
            );
          }}
          type="button"
          {...iconActionAttrs(t("viewer.fontPreviewTextReset"))}
        >
          <Icon name="undo" size={14} />
        </button>
        <label
          className="font-viewer-control"
          data-hover-tip={t("viewer.fontPreviewSize", { size: settings.size })}
        >
          <Icon name="text-size" size={14} />
          <input
            aria-label={t("viewer.fontPreviewSize", { size: settings.size })}
            max={FONT_VIEWER_MAX_SIZE}
            min={FONT_VIEWER_MIN_SIZE}
            onChange={(event) => update({ size: Number(event.currentTarget.value) })}
            step={1}
            type="range"
            value={settings.size}
          />
          <span className="font-viewer-control-value preview-zoom-label">
            {settings.size}
          </span>
        </label>
        {weightOptions.length > 0 ? (
          <div
            className="preview-color-space-control font-viewer-control"
            data-hover-tip={t("viewer.fontPreviewWeight")}
          >
            <Icon name="sliders" size={14} />
            <FontViewerMenu
              label={t("viewer.fontPreviewWeight")}
              onChange={(next) => {
                const weight = Number(next);
                if (Number.isFinite(weight)) update({ weight });
              }}
              options={weightOptions.map((weight) => ({
                value: String(weight),
                label: t("viewer.fontPreviewWeightValue", { weight }),
              }))}
              value={String(settings.weight)}
            />
          </div>
        ) : null}
        <button
          aria-label={t("viewer.fontPreviewBold")}
          aria-pressed={settings.bold}
          className={settings.bold ? "is-active" : undefined}
          onClick={() => update({ bold: !settings.bold })}
          data-hover-tip={t("viewer.fontPreviewBold")}
          type="button"
        >
          <span className="font-viewer-style-glyph" data-style="bold">
            B
          </span>
        </button>
        <button
          aria-label={t("viewer.fontPreviewItalic")}
          aria-pressed={settings.italic}
          className={settings.italic ? "is-active" : undefined}
          onClick={() => update({ italic: !settings.italic })}
          data-hover-tip={t("viewer.fontPreviewItalic")}
          type="button"
        >
          <span className="font-viewer-style-glyph" data-style="italic">
            I
          </span>
        </button>
        <button
          aria-label={t("viewer.fontPreviewUnderline")}
          aria-pressed={settings.underline}
          className={settings.underline ? "is-active" : undefined}
          onClick={() => update({ underline: !settings.underline })}
          data-hover-tip={t("viewer.fontPreviewUnderline")}
          type="button"
        >
          <span className="font-viewer-style-glyph" data-style="underline">
            U
          </span>
        </button>
        {/* 语言放在工具条最后（用户口径）。 */}
        <div
          className="preview-color-space-control font-viewer-control"
          data-hover-tip={t("viewer.fontPreviewLanguage")}
        >
          <Icon name="globe" size={14} />
          <FontViewerMenu
            label={t("viewer.fontPreviewLanguage")}
            onChange={(next) => {
              if (!isFontPreviewLanguage(next)) return;
              setLanguageTouched(true);
              update({ language: next });
            }}
            options={FONT_PREVIEW_LANGUAGES.map((language) => ({
              value: language,
              label: t(languageLabelKey(language)),
            }))}
            value={settings.language}
          />
        </div>
      </div>
    </div>
  );
}
