import { useEffect, useMemo, useState } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import { TEXT_VIEWER_MAX_BYTES, countTextLines } from "../shared/text-media";
import { useT } from "./i18n";

export type TextViewerControlsProps = {
  api: SerpentLibraryApi;
  libraryId: string;
  assetId: string;
  onSaved?: () => void;
  onError?: (message: string) => void;
};

/**
 * Numbered text viewer/editor (Serpent-sh7). Content is loaded via capped Worker
 * IPC — never via unbounded serpent://source fetch.
 */
export function TextViewerControls({
  api,
  libraryId,
  assetId,
  onSaved,
  onError,
}: TextViewerControlsProps) {
  const t = useT();
  const [content, setContent] = useState("");
  const [baseline, setBaseline] = useState("");
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [editable, setEditable] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Parent remounts with key=`${libraryId}:${assetId}` so loading starts true.
  useEffect(() => {
    let cancelled = false;
    void api
      .readTextAsset({ libraryId, assetId, maxBytes: TEXT_VIEWER_MAX_BYTES })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          onError?.(result.error.message);
          setLoading(false);
          return;
        }
        setContent(result.value.content);
        setBaseline(result.value.content);
        setRevisionId(result.value.revisionId);
        setEditable(result.value.editable);
        setTruncated(result.value.truncated);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        onError?.(
          error instanceof Error ? error.message : t("preview.textLoadFailed"),
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, assetId, libraryId, onError, t]);

  const dirty = content !== baseline;
  const lineCount = useMemo(() => countTextLines(content), [content]);
  const gutter = useMemo(
    () =>
      Array.from({ length: lineCount }, (_, index) => String(index + 1)).join(
        "\n",
      ),
    [lineCount],
  );

  async function save() {
    if (!editable || !dirty || saving) return;
    setSaving(true);
    try {
      const result = await api.saveTextAsset({
        libraryId,
        assetId,
        content,
        expectedRevisionId: revisionId ?? undefined,
      });
      if (!result.ok) {
        onError?.(result.error.message);
        return;
      }
      setBaseline(content);
      setRevisionId(result.value.revisionId);
      setTruncated(false);
      onSaved?.();
    } catch (error) {
      onError?.(
        error instanceof Error ? error.message : t("preview.textSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="preview-text-stage" role="status">
        {t("preview.textLoading")}
      </div>
    );
  }

  return (
    <div className="preview-text-stage">
      <div className="preview-text-toolbar preview-chrome-fade">
        <span className="preview-text-meta">
          {t("preview.textLineCount", { count: lineCount })}
          {truncated ? ` · ${t("preview.textTruncated")}` : ""}
          {!editable ? ` · ${t("preview.textReadOnly")}` : ""}
        </span>
        {editable && (
          <button
            className="preview-text-save"
            disabled={!dirty || saving}
            onClick={() => void save()}
            type="button"
          >
            {saving ? t("preview.textSaving") : t("preview.textSave")}
          </button>
        )}
      </div>
      <div className="preview-text-editor">
        <pre aria-hidden="true" className="preview-text-gutter">
          {gutter}
        </pre>
        <textarea
          aria-label={t("preview.textEditorAria")}
          className="preview-text-input"
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
              event.preventDefault();
              void save();
            }
          }}
          readOnly={!editable}
          spellCheck={false}
          value={content}
        />
      </div>
    </div>
  );
}
