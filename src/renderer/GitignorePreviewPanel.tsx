import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { GitignorePreview } from "../shared/asset-types";
import {
  GITIGNORE_PREVIEW_ROW_LIMIT,
  buildGitignorePreviewListRows,
} from "../shared/gitignore-preview";
import type { PluginWidgetNode, PluginWidgetValue } from "../shared/plugin-widget-ir";
import { useT } from "./i18n";
import { PluginWidgetRenderer } from "./plugin-widget-renderer";

const EMPTY_WIDGET_VALUES = new Map<string, PluginWidgetValue>();

function ignorePreviewWidgetChange(): void {
  // The preview list is read-only Host widget IR.
}

export function GitignorePreviewPanel({
  draft,
  onPreview,
}: {
  draft: string;
  onPreview: (content: string) => Promise<GitignorePreview | null>;
}): ReactNode {
  const t = useT();
  const [preview, setPreview] = useState<GitignorePreview | null>(null);
  const onPreviewRef = useRef(onPreview);

  useEffect(() => {
    onPreviewRef.current = onPreview;
  }, [onPreview]);

  useEffect(() => {
    let cancelled = false;
    void onPreviewRef.current(draft).then((next) => {
      if (cancelled || !next) return;
      setPreview(next);
    });
    return () => {
      cancelled = true;
    };
  }, [draft]);

  const tree = useMemo<PluginWidgetNode>(() => ({
    type: "list",
    columns: [t("settings.gitignorePreviewCurrent"), t("settings.gitignorePreviewAfterSave")],
    rows: preview ? buildGitignorePreviewListRows(preview.rows) : [],
    emptyText: t("settings.gitignorePreviewEmpty"),
  }), [preview, t]);

  const summary = preview === null
    ? null
    : preview.addedCount === 0 && preview.removedCount === 0
      ? t("settings.gitignorePreviewSummary", { current: preview.currentCount })
      : t("settings.gitignorePreviewSummaryDiff", {
        current: preview.currentCount,
        added: preview.addedCount,
        removed: preview.removedCount,
      });

  return (
    <div className="library-settings-gitignore-preview">
      <div className="app-settings-row-copy">
        <strong>{t("settings.gitignorePreview")}</strong>
      </div>
      {summary ? <p className="plugin-widget-note">{summary}</p> : null}
      {preview?.truncated === true ? (
        <p className="plugin-widget-note">
          {t("settings.gitignorePreviewTruncated", { limit: GITIGNORE_PREVIEW_ROW_LIMIT })}
        </p>
      ) : null}
      <PluginWidgetRenderer
        onChange={ignorePreviewWidgetChange}
        tree={tree}
        values={EMPTY_WIDGET_VALUES}
      />
    </div>
  );
}
