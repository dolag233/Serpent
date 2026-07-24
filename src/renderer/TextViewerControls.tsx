import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import { TEXT_VIEWER_MAX_BYTES, countTextLines } from "../shared/text-media";
import { messageForPublicError } from "./error-utils";
import { useLocale, useT } from "./i18n";
import { invalidateTextAssetPreviewCache } from "./TextAssetPreviewTile";

export type TextViewerControlsProps = {
  api: SerpentLibraryApi;
  libraryId: string;
  assetId: string;
  onClose: () => void;
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
export const TextViewerControls = forwardRef<
  TextViewerControlsHandle,
  TextViewerControlsProps
>(function TextViewerControls(
  {
    api,
    libraryId,
    assetId,
    onClose,
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
  const [actionError, setActionError] = useState<string | null>(null);
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

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
    const layer = textarea.parentElement;
    const minWidth = layer?.clientWidth ?? 0;
    textarea.style.width = "0px";
    textarea.style.width = `${Math.max(textarea.scrollWidth, minWidth)}px`;
  }, []);

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
  const sessionChanged = content !== openedContent;
  const lineCount = useMemo(() => countTextLines(content), [content]);
  const gutter = useMemo(
    () =>
      Array.from({ length: lineCount }, (_, index) => String(index + 1)).join(
        "\n",
      ),
    [lineCount],
  );

  useEffect(() => {
    resizeTextarea();
  }, [content, lineCount, loading, resizeTextarea]);

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
          error instanceof Error
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
    return (
      <div className="preview-text-stage" role="status">
        {t("preview.textLoading")}
      </div>
    );
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
          {editable ? (
            <button
              className="preview-text-action-chip"
              disabled={!dirty || saving}
              onClick={() => void save({ createRevision: false })}
              type="button"
            >
              {saving ? t("preview.textSaving") : t("preview.textSave")}
            </button>
          ) : null}
          <button
            className="preview-text-action-chip"
            onClick={() => void handleClose()}
            type="button"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
      <div className="preview-text-scroll">
        <div className="preview-text-line-layer">
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
        </div>
      </div>
    </div>
  );
});
