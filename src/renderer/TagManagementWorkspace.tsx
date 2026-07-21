/**
 * Full-page tag CRUD workspace (REQ-TAG-001 / Serpent-mqp).
 * Replaces the asset canvas while open; double-click opens that tag's assets.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { TagSummary } from "../shared/asset-types";
import { Icon } from "./Icons";
import { useT } from "./i18n";

export type TagManagementWorkspaceProps = {
  tags: readonly TagSummary[];
  busy: boolean;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (tagId: string, name: string) => Promise<boolean>;
  onDelete: (tagId: string) => Promise<boolean>;
  /** Leave management and browse assets with this tag. */
  onOpenTag: (tagId: string) => void;
};

export function TagManagementWorkspace({
  tags,
  busy,
  onCreate,
  onRename,
  onDelete,
  onOpenTag,
}: TagManagementWorkspaceProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [draftName, setDraftName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<TagSummary | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...tags].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    if (!needle) return sorted;
    return sorted.filter((tag) => tag.name.toLowerCase().includes(needle));
  }, [query, tags]);

  async function submitCreate() {
    const name = draftName.trim();
    if (!name || busy) return;
    if (await onCreate(name)) setDraftName("");
  }

  async function submitRename(tagId: string) {
    const name = renameValue.trim();
    if (!name || busy) return;
    if (await onRename(tagId, name)) {
      setRenamingId(null);
      setRenameValue("");
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || busy) return;
    if (await onDelete(pendingDelete.tagId)) setPendingDelete(null);
  }

  return (
    <div className="tag-management" data-testid="tag-management-workspace">
      <header className="tag-management-header">
        <div>
          <h2 className="tag-management-title">{t("tagMgmt.title")}</h2>
          <p className="tag-management-hint">{t("tagMgmt.hint")}</p>
        </div>
        <input
          aria-label={t("tagMgmt.search")}
          className="text-field tag-management-search"
          disabled={busy}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("tagMgmt.searchPlaceholder")}
          type="search"
          value={query}
        />
      </header>

      <form
        className="tag-management-create"
        onSubmit={(event) => {
          event.preventDefault();
          void submitCreate();
        }}
      >
        <input
          aria-label={t("tagMgmt.newTagName")}
          className="text-field"
          disabled={busy}
          maxLength={80}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder={t("tagMgmt.newTagPlaceholder")}
          type="text"
          value={draftName}
        />
        <button
          className="primary-button"
          disabled={busy || !draftName.trim()}
          type="submit"
        >
          {t("tagMgmt.create")}
        </button>
      </form>

      {filtered.length === 0 ? (
        <p className="tag-management-empty">
          {tags.length === 0 ? t("tagMgmt.empty") : t("tagMgmt.noMatches")}
        </p>
      ) : (
        <ul className="tag-management-list">
          {filtered.map((tag) => {
            const renaming = renamingId === tag.tagId;
            return (
              <li className="tag-management-row" key={tag.tagId}>
                {renaming ? (
                  <form
                    className="tag-management-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitRename(tag.tagId);
                    }}
                  >
                    <input
                      aria-label={t("tagMgmt.rename")}
                      className="text-field"
                      disabled={busy}
                      maxLength={80}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setRenamingId(null);
                          setRenameValue("");
                        }
                      }}
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                    />
                    <button
                      className="primary-button"
                      disabled={busy || !renameValue.trim()}
                      type="submit"
                    >
                      {t("common.save")}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        setRenamingId(null);
                        setRenameValue("");
                      }}
                      type="button"
                    >
                      {t("common.cancel")}
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className="tag-management-open"
                      disabled={busy}
                      onDoubleClick={() => onOpenTag(tag.tagId)}
                      title={t("tagMgmt.openHint")}
                      type="button"
                    >
                      <Icon name="tag" size={15} />
                      <span className="tag-management-name">{tag.name}</span>
                      <span className="tag-management-count">
                        {t("tagMgmt.assetCount", { count: tag.assetCount })}
                      </span>
                    </button>
                    <div className="tag-management-actions">
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => {
                          setRenamingId(tag.tagId);
                          setRenameValue(tag.name);
                        }}
                        type="button"
                      >
                        {t("tagMgmt.rename")}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => setPendingDelete(tag)}
                        type="button"
                      >
                        {t("tagMgmt.delete")}
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pendingDelete ? (
        <div
          aria-modal="true"
          className="tag-management-confirm"
          role="dialog"
        >
          <p>
            {t("tagMgmt.deleteConfirm", {
              name: pendingDelete.name,
              count: pendingDelete.assetCount,
            })}
          </p>
          <div className="tag-management-confirm-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setPendingDelete(null)}
              type="button"
            >
              {t("common.cancel")}
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void confirmDelete()}
              type="button"
            >
              {t("tagMgmt.delete")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
