/**
 * Chip-grid tag management workspace (Serpent-eaxs / REQ-TAG-010–013 redo;
 * supersedes the rolled-back Serpent-36il attempt).
 *
 * Replaces the asset canvas while open. Tags render as a flow of chips (the
 * same visual language as asset tag chips), sortable by name or asset count.
 * Selection mirrors the asset canvas model (plain/toggle/range clicks); the
 * right-click menu offers AND/OR asset search, merge, batch delete and
 * single-tag rename. Double-click browses exactly the double-clicked tag,
 * independent of the selection (REQ-TAG-013).
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import type { TagSummary } from "../shared/asset-types";
import {
  ContextMenu,
  ContextMenuBackdrop,
  ContextMenuItem,
  ContextMenuSection,
} from "./context-menu";
import { Icon } from "./Icons";
import { useLocale, useT } from "./i18n";
import { isImeKeyboardEvent } from "./ime-safe-dismiss";
import {
  applyTagSelectionClick,
  filterTagsByQuery,
  resolveTagMenuTargetIds,
  sortTags,
  type TagSelectionState,
  type TagSortDirection,
  type TagSortKey,
} from "./tag-management-model";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";
import { DialogShell } from "./ui/patterns";

export type TagManagementWorkspaceProps = {
  tags: readonly TagSummary[];
  busy: boolean;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (tagId: string, name: string) => Promise<boolean>;
  onDeleteMany: (tagIds: string[]) => Promise<boolean>;
  onMerge: (tagIds: string[], name: string) => Promise<boolean>;
  /** Leave management and browse assets with this one tag. */
  onOpenTag: (tagId: string) => void;
  /** Leave management and browse assets matching all/any of the tag names. */
  onSearchTags: (tagNames: string[], match: "all" | "any") => void;
};

type MenuState = {
  x: number;
  y: number;
  targetIds: string[];
};

export function TagManagementWorkspace({
  tags,
  busy,
  onCreate,
  onRename,
  onDeleteMany,
  onMerge,
  onOpenTag,
  onSearchTags,
}: TagManagementWorkspaceProps) {
  const t = useT();
  const { locale } = useLocale();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<TagSortKey>("name");
  const [sortDirection, setSortDirection] = useState<TagSortDirection>("asc");
  const [draftName, setDraftName] = useState("");
  const draftRevisionRef = useRef(0);
  const [selection, setSelection] = useState<TagSelectionState>({
    selectedIds: [],
    anchorId: null,
  });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(
    null,
  );
  const [pendingMergeIds, setPendingMergeIds] = useState<string[] | null>(null);
  const [mergeName, setMergeName] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  useEffect(() => {
    if (pendingMergeIds) mergeInputRef.current?.focus();
  }, [pendingMergeIds]);

  const tagById = useMemo(
    () => new Map(tags.map((tag) => [tag.tagId, tag])),
    [tags],
  );

  // Selection may briefly reference ids removed by delete/merge; prune them
  // derivatively instead of syncing state in an effect. Every selection
  // transition below rebases onto this pruned list, so stale ids clean
  // themselves up on the next interaction.
  const prunedSelectedIds = useMemo(
    () => selection.selectedIds.filter((id) => tagById.has(id)),
    [selection.selectedIds, tagById],
  );

  const visible = useMemo(
    () => sortTags(filterTagsByQuery(tags, query), sortKey, sortDirection),
    [tags, query, sortKey, sortDirection],
  );
  const visibleOrder = useMemo(
    () => visible.map((tag) => tag.tagId),
    [visible],
  );
  const selectedIdSet = useMemo(
    () => new Set(prunedSelectedIds),
    [prunedSelectedIds],
  );

  function handleSortClick(key: TagSortKey) {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    // Name reads naturally A→Z; count reads naturally most-used-first.
    setSortDirection(key === "count" ? "desc" : "asc");
  }

  async function submitCreate() {
    const name = draftName.trim();
    if (!name || busy) return;
    const submittedRevision = draftRevisionRef.current;
    // Clear before awaiting the IPC round trip so a user can start the next
    // tag immediately. A late completion must not erase that newer draft.
    setDraftName("");
    if (!(await onCreate(name)) && draftRevisionRef.current === submittedRevision) {
      // Preserve the failed name when the user has not started another draft.
      setDraftName(name);
    }
  }

  function beginRename(tagId: string) {
    const tag = tagById.get(tagId);
    if (!tag || busy) return;
    setRenamingId(tagId);
    setRenameValue(tag.name);
  }

  async function submitRename(tagId: string) {
    const name = renameValue.trim();
    if (!name || busy) return;
    if (await onRename(tagId, name)) {
      setRenamingId(null);
      setRenameValue("");
    }
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
  }

  function openMenu(event: MouseEvent, tagId: string) {
    event.preventDefault();
    const targetIds = resolveTagMenuTargetIds(prunedSelectedIds, tagId);
    setSelection({ selectedIds: targetIds, anchorId: tagId });
    setMenu({ x: event.clientX, y: event.clientY, targetIds });
  }

  function targetNames(ids: readonly string[]): string[] {
    return ids
      .map((id) => tagById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
  }

  async function confirmDelete() {
    if (!pendingDeleteIds || busy) return;
    if (await onDeleteMany(pendingDeleteIds)) setPendingDeleteIds(null);
  }

  async function confirmMerge() {
    const name = mergeName.trim();
    if (!pendingMergeIds || !name || busy) return;
    if (await onMerge(pendingMergeIds, name)) {
      setPendingMergeIds(null);
      setMergeName("");
    }
  }

  // Escape / backdrop dismissal for the two local dialogs. The App-level
  // escape stack has no active layer while tag management is open, so a
  // plain document listener is sufficient and cannot double-fire.
  const activeDialog = pendingDeleteIds !== null || pendingMergeIds !== null;
  useDialogFocusTrap(activeDialog);
  useEffect(() => {
    if (!activeDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isImeKeyboardEvent(event)) return;
      event.preventDefault();
      setPendingDeleteIds(null);
      setPendingMergeIds(null);
      setMergeName("");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeDialog]);

  const menuSingle = menu !== null && menu.targetIds.length === 1;
  const pendingDeleteTags =
    pendingDeleteIds?.map((id) => tagById.get(id)).filter(Boolean) ?? [];
  const pendingMergeNames = pendingMergeIds
    ? targetNames(pendingMergeIds)
    : [];
  const pendingMergeNamesText = new Intl.ListFormat(locale, {
    style: "narrow",
    type: "conjunction",
  }).format(pendingMergeNames);

  return (
    // stopPropagation keeps canvas-level handlers (marquee selection, blank
    // canvas focus steal) from intercepting management-page interactions.
    <div
      className="tag-management"
      data-testid="tag-management-workspace"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !menu && !activeDialog) {
          if (isImeKeyboardEvent(event.nativeEvent)) return;
          setSelection({ selectedIds: [], anchorId: null });
        }
        if (
          event.key === "F2" &&
          prunedSelectedIds.length === 1 &&
          !renamingId
        ) {
          event.preventDefault();
          beginRename(prunedSelectedIds[0]!);
        }
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header className="tag-management-header">
        <h2 className="tag-management-title">{t("tagMgmt.title")}</h2>
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

      <div className="tag-management-toolbar">
        <div
          aria-label={t("tagMgmt.sortLabel")}
          className="tag-management-sort"
          role="group"
        >
          {(["name", "count"] as const).map((key) => (
            <button
              aria-pressed={sortKey === key}
              className={`dimension-filter-btn${sortKey === key ? " is-active" : ""}`}
              key={key}
              onClick={() => handleSortClick(key)}
              title={
                sortKey === key
                  ? t(
                      sortDirection === "asc"
                        ? "tagMgmt.sortAscending"
                        : "tagMgmt.sortDescending",
                    )
                  : undefined
              }
              type="button"
            >
              {t(key === "name" ? "tagMgmt.sortName" : "tagMgmt.sortCount")}
              {sortKey === key ? (
                <span aria-hidden="true" className="sort-order-glyph">
                  <Icon
                    name={sortDirection === "asc" ? "sort-asc" : "sort-desc"}
                    size={14}
                  />
                </span>
              ) : null}
            </button>
          ))}
        </div>

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
            onChange={(event) => {
              draftRevisionRef.current += 1;
              setDraftName(event.target.value);
            }}
            placeholder={t("tagMgmt.newTagPlaceholder")}
            type="text"
            value={draftName}
          />
          <button
            className="secondary-button"
            disabled={busy || !draftName.trim()}
            type="submit"
          >
            {t("tagMgmt.create")}
          </button>
        </form>

        {prunedSelectedIds.length > 0 && (
          <div className="tag-management-selection">
            <span>
              {t("tagMgmt.selectedCount", {
                count: prunedSelectedIds.length,
              })}
            </span>
            <button
              className="secondary-button"
              onClick={() => setSelection({ selectedIds: [], anchorId: null })}
              type="button"
            >
              {t("tagMgmt.clearSelection")}
            </button>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="tag-management-empty">
          {tags.length === 0 ? t("tagMgmt.empty") : t("tagMgmt.noMatches")}
        </p>
      ) : (
        <div
          aria-label={t("tagMgmt.title")}
          aria-multiselectable="true"
          className="tag-management-grid"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelection({ selectedIds: [], anchorId: null });
            }
          }}
          role="listbox"
        >
          {visible.map((tag) => {
            const selected = selectedIdSet.has(tag.tagId);
            const renaming = renamingId === tag.tagId;
            return (
              <div
                aria-selected={selected}
                className={`tag-management-chip${selected ? " is-selected" : ""}`}
                key={tag.tagId}
                onClick={(event) => {
                  if (renaming) return;
                  setSelection(
                    applyTagSelectionClick(
                      { ...selection, selectedIds: prunedSelectedIds },
                      tag.tagId,
                      visibleOrder,
                      {
                        toggle: event.metaKey || event.ctrlKey,
                        range: event.shiftKey,
                      },
                    ),
                  );
                }}
                onContextMenu={(event) => openMenu(event, tag.tagId)}
                onDoubleClick={() => {
                  if (!renaming) onOpenTag(tag.tagId);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !renaming) {
                    event.preventDefault();
                    onOpenTag(tag.tagId);
                  }
                }}
                role="option"
                tabIndex={0}
                title={t("tagMgmt.openHint")}
              >
                <Icon name="tag" size={13} />
                {renaming ? (
                  <input
                    aria-label={t("tagMgmt.rename")}
                    className="text-field tag-management-chip-rename"
                    disabled={busy}
                    maxLength={80}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (isImeKeyboardEvent(event)) return;
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitRename(tag.tagId);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                  />
                ) : (
                  <span className="tag-management-chip-name">{tag.name}</span>
                )}
                <span className="tag-management-chip-count">
                  {tag.assetCount}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {menu && (
        <ContextMenuBackdrop onClose={() => setMenu(null)}>
          <ContextMenu
            ariaLabel={t("tagMgmt.menuAriaLabel", {
              count: menu.targetIds.length,
            })}
            position={{ x: menu.x, y: menu.y }}
          >
            {menuSingle ? (
              <ContextMenuSection>
                <ContextMenuItem
                  label={t("tagMgmt.openTag")}
                  onAction={() => {
                    setMenu(null);
                    onOpenTag(menu.targetIds[0]!);
                  }}
                />
                <ContextMenuItem
                  label={t("tagMgmt.rename")}
                  onAction={() => {
                    setMenu(null);
                    beginRename(menu.targetIds[0]!);
                  }}
                />
              </ContextMenuSection>
            ) : (
              <ContextMenuSection>
                <ContextMenuItem
                  label={t("tagMgmt.searchAll", {
                    count: menu.targetIds.length,
                  })}
                  onAction={() => {
                    setMenu(null);
                    onSearchTags(targetNames(menu.targetIds), "all");
                  }}
                />
                <ContextMenuItem
                  label={t("tagMgmt.searchAny", {
                    count: menu.targetIds.length,
                  })}
                  onAction={() => {
                    setMenu(null);
                    onSearchTags(targetNames(menu.targetIds), "any");
                  }}
                />
                <ContextMenuItem
                  label={t("tagMgmt.merge", { count: menu.targetIds.length })}
                  onAction={() => {
                    setMenu(null);
                    setMergeName("");
                    setPendingMergeIds(menu.targetIds);
                  }}
                />
              </ContextMenuSection>
            )}
            <ContextMenuSection>
              <ContextMenuItem
                danger
                label={
                  menuSingle
                    ? t("tagMgmt.delete")
                    : t("tagMgmt.deleteMany", {
                        count: menu.targetIds.length,
                      })
                }
                onAction={() => {
                  setMenu(null);
                  setPendingDeleteIds(menu.targetIds);
                }}
              />
            </ContextMenuSection>
          </ContextMenu>
        </ContextMenuBackdrop>
      )}

      {pendingDeleteIds && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingDeleteIds(null);
          }}
          role="presentation"
        >
          <DialogShell
            className="create-dialog"
            dialogId="tag-delete-dialog"
            onRequestClose={() => setPendingDeleteIds(null)}
            style={{ padding: 0 }}
            title={t("tagMgmt.delete")}
          >
            <p className="dialog-body-copy">
              {pendingDeleteIds.length === 1 && pendingDeleteTags[0]
                ? t("tagMgmt.deleteConfirm", {
                    name: pendingDeleteTags[0].name,
                    count: pendingDeleteTags[0].assetCount,
                  })
                : t("tagMgmt.deleteManyConfirm", {
                    count: pendingDeleteIds.length,
                  })}
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setPendingDeleteIds(null)}
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
          </DialogShell>
        </div>
      )}

      {pendingMergeIds && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setPendingMergeIds(null);
              setMergeName("");
            }
          }}
          role="presentation"
        >
          <DialogShell
            className="create-dialog"
            dialogId="tag-merge-dialog"
            onRequestClose={() => {
              setPendingMergeIds(null);
              setMergeName("");
            }}
            style={{ padding: 0 }}
            title={t("tagMgmt.mergeTitle")}
          >
            <p className="dialog-body-copy">
              {t("tagMgmt.mergeHint", {
                count: pendingMergeIds.length,
                names: pendingMergeNamesText,
              })}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void confirmMerge();
              }}
            >
              <input
                aria-label={t("tagMgmt.mergeNameLabel")}
                className="text-field"
                disabled={busy}
                maxLength={80}
                onChange={(event) => setMergeName(event.target.value)}
                placeholder={t("tagMgmt.newTagPlaceholder")}
                ref={mergeInputRef}
                type="text"
                value={mergeName}
              />
              <div className="dialog-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setPendingMergeIds(null);
                    setMergeName("");
                  }}
                  type="button"
                >
                  {t("common.cancel")}
                </button>
                <button
                  className="primary-button"
                  disabled={busy || !mergeName.trim()}
                  type="submit"
                >
                  {t("tagMgmt.mergeSubmit")}
                </button>
              </div>
            </form>
          </DialogShell>
        </div>
      )}
    </div>
  );
}
