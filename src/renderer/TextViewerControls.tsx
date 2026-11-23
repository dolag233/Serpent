import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { parseAssetMarkdown } from "../plugins/plugin-community-readme";
import type { SerpentShellApi } from "../shared/external-url";
import type { SerpentLibraryApi } from "../shared/library-api";
import { TEXT_VIEWER_MAX_BYTES, countTextLines } from "../shared/text-media";
import { LibraryOperationError, messageForPublicError, toMessage } from "./error-utils";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useLocale, useT } from "./i18n";
import { PluginReadmeView } from "./PluginReadmeView";
import { applyTextViewerTextareaLayout } from "./text-viewer-layout";
import { invalidateTextAssetPreviewCache } from "./TextAssetPreviewTile";

export type TextViewerControlsProps = {
  api: SerpentLibraryApi;
  libraryId: string;
  assetId: string;
  /** `.md` / `.markdown` can switch between the source editor and rendered preview. */
  markdown?: boolean;
  onClose: () => void;
  onPresentationReady?: () => void;
  onSaved?: () => void;
};

export type TextViewerControlsHandle = {
  save: () => Promise<boolean>;
  /** Persist edits and create a revision when the session changed, then allow close. */
  flushBeforeClose: () => Promise<boolean>;
};

/**
 * Numbered text viewer/editor (Serpent-sh7). Content is loaded via capped Worker
 * IPC — never via unbounded serpent://source fetch.
 */
let persistTextViewerWrap = true;
let persistMarkdownPreview = true;

export function resetTextViewerModeForTests(): void {
  persistTextViewerWrap = true;
  persistMarkdownPreview = true;
}

function shellApi(): SerpentShellApi | undefined {
  return (window as Window & { serpent?: { shell?: SerpentShellApi } }).serpent?.shell;
}

export const TextViewerControls = forwardRef<
  TextViewerControlsHandle,
  TextViewerControlsProps
>(function TextViewerControls(
  {
    api,
    libraryId,
    assetId,
    markdown = false,
    onClose,
    onPresentationReady,
    onSaved,
  },
  ref,
) {
  const t = useT();
  const { locale } = useLocale();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState("");
  const [baseline, setBaseline] = useState("");
  const [openedContent, setOpenedContent] = useState("");
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [editable, setEditable] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wrap, setWrap] = useState(persistTextViewerWrap);
  const [markdownMode, setMarkdownMode] = useState(markdown && persistMarkdownPreview);
  const [actionError, setActionError] = useState<string | null>(null);
  const markdownBlocks = useMemo(
    () => (markdown && markdownMode ? parseAssetMarkdown(content) : []),
    [content, markdown, markdownMode],
  );
  const onSavedRef = useRef(onSaved);
  const contentRef = useRef(content);
  const baselineRef = useRef(baseline);
  const openedContentRef = useRef(openedContent);
  const editableRef = useRef(editable);
  const revisionIdRef = useRef(revisionId);
  const savingRef = useRef(saving);

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  useEffect(() => {
    baselineRef.current = baseline;
  }, [baseline]);
  useEffect(() => {
    openedContentRef.current = openedContent;
  }, [openedContent]);
  useEffect(() => {
    editableRef.current = editable;
  }, [editable]);
  useEffect(() => {
    revisionIdRef.current = revisionId;
  }, [revisionId]);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  const sourceVisible = !loading && !(markdown && markdownMode);

  const syncSourceLayout = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    applyTextViewerTextareaLayout(textarea, wrap);
  }, [wrap]);

  // Parent remounts with key=`${libraryId}:${assetId}` so loading starts true.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setActionError(null);
    void api
      .readTextAsset({ libraryId, assetId, maxBytes: TEXT_VIEWER_MAX_BYTES })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setActionError(result.error.message);
          setLoading(false);
          return;
        }
        setContent(result.value.content);
        setBaseline(result.value.content);
        setOpenedContent(result.value.content);
        setRevisionId(result.value.revisionId);
        setEditable(result.value.editable);
        setTruncated(result.value.truncated);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setActionError(
          error instanceof Error ? error.message : t("preview.textLoadFailed"),
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, assetId, libraryId, t]);

  const dirty = content !== baseline;
  const lineCount = useMemo(() => countTextLines(content), [content]);
  const showLineNumbers = sourceVisible && !wrap;
  const gutter = useMemo(
    () =>
      showLineNumbers
        ? Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n")
        : "",
    [lineCount, showLineNumbers],
  );

  useLayoutEffect(() => {
    if (!sourceVisible) return;
    syncSourceLayout();
  }, [sourceVisible, syncSourceLayout]);

  useEffect(() => {
    if (!sourceVisible) return;
    const textarea = textareaRef.current;
    const stage = textarea?.closest(".preview-text-scroll");
    if (!textarea || !(stage instanceof HTMLElement)) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      syncSourceLayout();
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [sourceVisible, syncSourceLayout]);

  useEffect(() => {
    if (!loading) onPresentationReady?.();
  }, [loading, onPresentationReady]);

  const save = useCallback(
    async (options?: { createRevision?: boolean }): Promise<boolean> => {
      const createRevision = options?.createRevision === true;
      const currentContent = contentRef.current;
      const currentBaseline = baselineRef.current;
      const currentOpened = openedContentRef.current;
      const currentEditable = editableRef.current;
      const currentRevisionId = revisionIdRef.current;
      if (!currentEditable || savingRef.current) return true;
      const needsWrite = currentContent !== currentBaseline;
      const needsRevision =
        createRevision && currentContent !== currentOpened;
      if (!needsWrite && !needsRevision) return true;

      setSaving(true);
      setActionError(null);
      try {
        const result = await api.saveTextAsset({
          libraryId,
          assetId,
          content: currentContent,
          expectedRevisionId: currentRevisionId ?? undefined,
          createRevision: needsRevision,
        });
        if (!result.ok) {
          if (result.error.code === "VERSION_CONFLICT") {
            try {
              const latest = await api.readTextAsset({
                libraryId,
                assetId,
                maxBytes: TEXT_VIEWER_MAX_BYTES,
              });
              if (latest.ok) {
                setRevisionId(latest.value.revisionId);
                setTruncated(latest.value.truncated);
                setEditable(latest.value.editable);
              }
            } catch {
              // Keep the conflict message below.
            }
          }
          setActionError(
            t("preview.textSaveFailedWithDetail", {
              detail: messageForPublicError(result.error, locale),
            }),
          );
          return false;
        }
        setBaseline(currentContent);
        if (needsRevision) {
          setOpenedContent(currentContent);
        }
        setRevisionId(result.value.revisionId);
        setTruncated(false);
        invalidateTextAssetPreviewCache(libraryId, assetId);
        onSavedRef.current?.();
        return true;
      } catch (error) {
        setActionError(
          error instanceof LibraryOperationError
            ? toMessage(error, t("preview.textSaveFailed"), locale)
            : error instanceof Error
              ? t("preview.textSaveFailedWithDetail", { detail: error.message })
              : t("preview.textSaveFailed"),
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [api, assetId, libraryId, locale, t],
  );

  const flushBeforeClose = useCallback(async (): Promise<boolean> => {
    if (!editableRef.current) return true;
    if (contentRef.current === openedContentRef.current) return true;
    return save({ createRevision: true });
  }, [save]);

  const handleClose = useCallback(async () => {
    if (!(await flushBeforeClose())) return;
    onClose();
  }, [flushBeforeClose, onClose]);

  useImperativeHandle(
    ref,
    () => ({
      save: () => save({ createRevision: false }),
      flushBeforeClose,
    }),
    [flushBeforeClose, save],
  );

  if (loading) {
    return null;
  }

  return (
    <div className="preview-text-stage">
      <div className="preview-text-topbar">
        <div className="preview-text-meta" aria-live="polite">
          <span>
            {t("preview.textLineCount", { count: lineCount })}
            {truncated ? ` · ${t("preview.textTruncated")}` : ""}
            {!editable ? ` · ${t("preview.textReadOnly")}` : ""}
          </span>
          {actionError ? (
            <button
              className="preview-text-error-btn"
              onClick={() => setActionError(null)}
              type="button"
            >
              {actionError}
            </button>
          ) : null}
        </div>
        <div className="preview-text-actions">
          {markdown ? (
            <>
              <button
                aria-pressed={!markdownMode}
                className={`preview-text-action${markdownMode ? "" : " is-active"}`}
                onClick={() => {
                  persistMarkdownPreview = false;
                  setMarkdownMode(false);
                }}
                type="button"
                {...iconActionAttrs(t("preview.textSource"))}
              >
                <Icon name="code" size={14} />
              </button>
              <button
                aria-pressed={markdownMode}
                className={`preview-text-action${markdownMode ? " is-active" : ""}`}
                onClick={() => {
                  persistMarkdownPreview = true;
                  setMarkdownMode(true);
                }}
                type="button"
                {...iconActionAttrs(t("preview.textMarkdown"))}
              >
                <Icon name="eye" size={14} />
              </button>
            </>
          ) : null}
          {markdown && markdownMode ? null : (
          <button
            aria-pressed={wrap}
            className={`preview-text-action${wrap ? " is-active" : ""}`}
            onClick={() => {
              persistTextViewerWrap = !persistTextViewerWrap;
              setWrap(persistTextViewerWrap);
            }}
            type="button"
            {...iconActionAttrs(t("preview.textWrap"))}
          >
            <Icon name="wrap-text" size={14} />
          </button>
          )}
          {editable ? (
            <button
              className="preview-text-action"
              disabled={!dirty || saving}
              onClick={() => void save({ createRevision: false })}
              type="button"
              {...iconActionAttrs(
                saving ? t("preview.textSaving") : t("preview.textSave"),
              )}
            >
              <Icon name="save" size={14} />
            </button>
          ) : null}
          <button
            className="preview-text-action"
            onClick={() => void handleClose()}
            type="button"
            {...iconActionAttrs(t("common.close"))}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
      <div className="preview-text-scroll">
        {markdown && markdownMode ? (
          <div className="preview-markdown">
            <PluginReadmeView
              blocks={markdownBlocks}
              empty={t("preview.textMarkdownEmpty")}
              imageLabel={t("preview.textMarkdownImage")}
              onOpenUrl={(href) => {
                void shellApi()?.openExternalUrl(href);
              }}
            />
          </div>
        ) : (
        <div className={`preview-text-line-layer${wrap ? " is-wrap" : ""}`}>
          {wrap ? (
            <textarea
              aria-label={t("preview.textEditorAria")}
              autoFocus={editable}
              className="preview-text-input is-wrap"
              onChange={(event) => setContent(event.target.value)}
              readOnly={!editable}
              ref={textareaRef}
              spellCheck={false}
              value={content}
            />
          ) : (
            <>
              <pre aria-hidden="true" className="preview-text-gutter">
                {gutter}
              </pre>
              <textarea
                aria-label={t("preview.textEditorAria")}
                autoFocus={editable}
                className="preview-text-input"
                onChange={(event) => setContent(event.target.value)}
                readOnly={!editable}
                ref={textareaRef}
                spellCheck={false}
                value={content}
              />
            </>
          )}
        </div>
        )}
      </div>
    </div>
  );
});
