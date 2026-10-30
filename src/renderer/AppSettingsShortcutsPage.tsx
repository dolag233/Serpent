import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Icon } from "./Icons";
import { useT } from "./i18n";
import { isImeKeyboardEvent } from "./ime-safe-dismiss";
import {
  buildShortcutRows,
  countShortcutRows,
  filterShortcutRows,
  groupShortcutRows,
  matchesShortcutQuery,
  type ShortcutFilter,
  type ShortcutGroupModel,
  type ShortcutRowModel,
} from "./shortcut-settings-model";
import { useShortcutSettings } from "./shortcut-provider";
import { findShortcutAction } from "../shared/shortcut-catalog";
import type { ShortcutScope } from "../shared/shortcut-catalog";
import {
  chordFromKeyboardEvent,
  findShortcutConflictsForChord,
  formatShortcutChord,
  validateShortcutChord,
  type ShortcutMouseLabels,
  type ShortcutConflict,
} from "../shared/shortcut-resolution";
import type { ShortcutChord } from "../shared/shortcut-catalog";
import { shortcutInputFromMouseEvent } from "./shortcut-runtime";
import { IconActionButton } from "./icon-action-button";
import { SettingsCard } from "./ui/patterns";

const SCOPE_LABEL_KEYS: Record<ShortcutScope, string> = {
  app: "shortcuts.scope.app",
  browse: "shortcuts.scope.browse",
  "sidebar.folder": "shortcuts.scope.sidebarFolder",
  "sidebar.collection": "shortcuts.scope.sidebarCollection",
  "viewer.base": "shortcuts.scope.viewerBase",
  "viewer.image": "shortcuts.scope.viewerImage",
  "viewer.video": "shortcuts.scope.viewerVideo",
  "viewer.audio": "shortcuts.scope.viewerAudio",
};

const FILTERS: readonly ShortcutFilter[] = ["all", "modified", "conflicts"];

type ConflictDraft = {
  readonly actionId: string;
  readonly chord: ShortcutChord;
  readonly conflicts: readonly ShortcutConflict[];
};

function scopeLabel(
  row: ShortcutRowModel,
  t: ReturnType<typeof useT>,
): string {
  return row.action.scopes.map((scope) => t(SCOPE_LABEL_KEYS[scope])).join(" / ");
}

function validationMessage(
  reason: string,
  t: ReturnType<typeof useT>,
): string {
  if (reason === "modifier-only") return t("shortcuts.modifierOnly");
  if (reason === "bare-key") return t("shortcuts.bareKey");
  if (reason === "ime-route-required") return t("shortcuts.imeRouteRequired");
  if (reason === "system") return t("shortcuts.reserved");
  if (reason === "no-key") return t("shortcuts.noKey");
  if (reason === "mouse-modifier-required") return t("shortcuts.mouseModifierRequired");
  if (reason === "mouse-button") return t("shortcuts.mouseButtonUnsupported");
  return t("shortcuts.updateFailed");
}

export function AppSettingsShortcutsPage(): ReactNode {
  const t = useT();
  const {
    platform,
    bindings,
    ready,
    error,
    saveOverride,
    resetAction: resetShortcutAction,
    resetAll,
    refresh,
    exportToFile,
    importFromFile,
  } = useShortcutSettings();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ShortcutFilter>("all");
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const [conflictDraft, setConflictDraft] = useState<ConflictDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [modifierPreview, setModifierPreview] = useState("");
  const [draftChord, setDraftChord] = useState<ShortcutChord | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(
    () => buildShortcutRows(platform, bindings, {
      mouseBack: t("shortcuts.mouse.back"),
      mouseForward: t("shortcuts.mouse.forward"),
      wheel: t("shortcuts.mouse.wheel"),
    } satisfies ShortcutMouseLabels),
    [bindings, platform, t],
  );
  const counts = useMemo(() => countShortcutRows(rows), [rows]);
  const visibleGroups = useMemo<ShortcutGroupModel[]>(() => {
    const filtered = filterShortcutRows(rows, filter).filter((row) =>
      matchesShortcutQuery(
        row,
        query,
        t(row.action.labelKey),
        scopeLabel(row, t),
      ),
    );
    return groupShortcutRows(filtered);
  }, [filter, query, rows, t]);

  useEffect(() => {
    if (notice === null) return;
    const timeout = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (editingActionId === null) return;
    captureRef.current?.focus();
  }, [editingActionId]);

  const cancelRecording = useCallback(() => {
    setEditingActionId(null);
    setRecorderError(null);
    setConflictDraft(null);
    setModifierPreview("");
    setDraftChord(null);
  }, []);

  const beginRecording = useCallback((actionId: string) => {
    setEditingActionId(actionId);
    setRecorderError(null);
    setConflictDraft(null);
    setConfirmResetAll(false);
    setModifierPreview("");
    setDraftChord(null);
  }, []);

  const applyChord = useCallback(
    async (actionId: string, chord: ShortcutChord) => {
      setSaving(true);
      const result = await saveOverride(actionId, chord);
      setSaving(false);
      if (!result.ok) {
        setRecorderError(result.error ?? "save");
        return;
      }
      const action = findShortcutAction(actionId);
      setNotice(
        t("shortcuts.updated", {
          name: action ? t(action.labelKey) : actionId,
        }),
      );
      cancelRecording();
    },
    [cancelRecording, saveOverride, t],
  );

  const acceptDraft = useCallback(() => {
    if (
      !editingActionId ||
      !draftChord ||
      recorderError !== null ||
      conflictDraft !== null ||
      saving
    ) {
      return;
    }
    void applyChord(editingActionId, draftChord);
  }, [
    applyChord,
    conflictDraft,
    draftChord,
    editingActionId,
    recorderError,
    saving,
  ]);

  useEffect(() => {
    if (editingActionId === null) return;
    const action = findShortcutAction(editingActionId);
    if (!action) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (saving || event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (isImeKeyboardEvent(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelRecording();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        acceptDraft();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      setModifierPreview(
        formatShortcutChord(
          {
            key: "",
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
          },
          platform,
        ),
      );

      const chord = chordFromKeyboardEvent(event);
      if (chord === null) {
        setRecorderError("modifier-only");
        return;
      }
      setConflictDraft(null);
      setDraftChord(chord);
      const reason = validateShortcutChord(chord, platform, action.scopes, action.id);
      if (reason !== null) {
        setRecorderError(reason);
        return;
      }
      setRecorderError(null);
      const conflicts = findShortcutConflictsForChord(
        action.id,
        chord,
        platform,
        bindings,
      );
      if (conflicts.length > 0) {
        setConflictDraft({ actionId: action.id, chord, conflicts });
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      setModifierPreview(
        formatShortcutChord(
          {
            key: "",
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
          },
          platform,
        ),
      );
    };
    const onMouseDown = (event: MouseEvent) => {
      const input = shortcutInputFromMouseEvent(event);
      if (input === null) return;
      // Side buttons otherwise trigger Chromium's back/forward navigation.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (saving) return;
      const chord: ShortcutChord = {
        key: input.button === 3 ? "MouseBack" : "MouseForward",
        ...(input.metaKey ? { metaKey: true } : {}),
        ...(input.ctrlKey ? { ctrlKey: true } : {}),
        ...(input.altKey ? { altKey: true } : {}),
        ...(input.shiftKey ? { shiftKey: true } : {}),
      };
      setModifierPreview("");
      setDraftChord(chord);
      setConflictDraft(null);
      const reason = validateShortcutChord(chord, platform, action.scopes, action.id);
      if (reason !== null) {
        setRecorderError(reason);
        return;
      }
      setRecorderError(null);
      const conflicts = findShortcutConflictsForChord(
        action.id,
        chord,
        platform,
        bindings,
      );
      if (conflicts.length > 0) {
        setConflictDraft({ actionId: action.id, chord, conflicts });
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (action.id !== "viewer.image.wheel-zoom") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (saving || event.deltaY === 0) return;
      const chord: ShortcutChord = {
        key: "Wheel",
        ...(event.metaKey ? { metaKey: true } : {}),
        ...(event.ctrlKey ? { ctrlKey: true } : {}),
        ...(event.altKey ? { altKey: true } : {}),
        ...(event.shiftKey ? { shiftKey: true } : {}),
      };
      setModifierPreview("");
      setDraftChord(chord);
      setRecorderError(null);
      const conflicts = findShortcutConflictsForChord(action.id, chord, platform, bindings);
      setConflictDraft(conflicts.length ? { actionId: action.id, chord, conflicts } : null);
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, [
    acceptDraft,
    bindings,
    cancelRecording,
    editingActionId,
    platform,
    saving,
  ]);

  const handleImport = useCallback(async () => {
    cancelRecording();
    const result = await importFromFile();
    if (result.ok) {
      setNotice(t("shortcuts.importDone"));
      cancelRecording();
      return;
    }
    if (!result.canceled) setNotice(t("shortcuts.importFailed"));
  }, [cancelRecording, importFromFile, t]);

  const handleExport = useCallback(async () => {
    cancelRecording();
    const result = await exportToFile();
    if (result.ok) {
      setNotice(t("shortcuts.exportDone"));
      return;
    }
    if (!result.canceled) setNotice(t("shortcuts.exportFailed"));
  }, [cancelRecording, exportToFile, t]);

  const clearBinding = useCallback(
    async (actionId: string) => {
      setSaving(true);
      const result = await saveOverride(actionId, null);
      setSaving(false);
      if (!result.ok) {
        setRecorderError(result.error ?? "save");
        return;
      }
      const action = findShortcutAction(actionId);
      setNotice(
        t("shortcuts.cleared", {
          name: action ? t(action.labelKey) : actionId,
        }),
      );
      cancelRecording();
    },
    [cancelRecording, saveOverride, t],
  );

  async function resetRow(actionId: string): Promise<void> {
    const result = await resetShortcutAction(actionId);
    if (!result.ok) {
      setRecorderError(result.error ?? "save");
      return;
    }
    const action = findShortcutAction(actionId);
    setNotice(
      t("shortcuts.resetDone", {
        name: action ? t(action.labelKey) : actionId,
      }),
    );
  }

  async function confirmResetAllShortcuts(): Promise<void> {
    setSaving(true);
    const result = await resetAll();
    setSaving(false);
    setConfirmResetAll(false);
    if (!result.ok) {
      setRecorderError(result.error ?? "save");
      return;
    }
    setNotice(t("shortcuts.resetAllDone"));
    cancelRecording();
  }

  if (!ready) {
    return <p className="app-settings-help-note">{t("shortcuts.loading")}</p>;
  }

  return (
    <div className="shortcut-settings-page">
      <p className="app-settings-help-note">{t("shortcuts.description")}</p>
      {error ? (
        <div className="shortcut-settings-error" role="alert">
          <span>
            {error === "shortcut-load-failed"
              ? t("shortcuts.loadFailed")
              : t("shortcuts.updateFailed")}
          </span>
          <button
            className="shortcut-settings-text-button"
            onClick={() => void refresh()}
            type="button"
          >
            {t("shortcuts.retry")}
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="shortcut-settings-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="shortcut-settings-toolbar">
        <input
          aria-label={t("shortcuts.search")}
          className="shortcut-settings-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("shortcuts.search")}
          type="search"
          value={query}
        />
        <div
          aria-label={t("shortcuts.search")}
          className="shortcut-settings-filters"
          role="group"
        >
          {FILTERS.map((value) => (
            <button
              aria-pressed={filter === value}
              className={`shortcut-settings-filter${filter === value ? " is-active" : ""}`}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {t(
                value === "all"
                  ? "shortcuts.filterAll"
                  : value === "modified"
                    ? "shortcuts.filterModified"
                    : "shortcuts.filterConflicts",
              )}
              <span className="shortcut-settings-filter-count">
                {value === "all"
                  ? counts.all
                  : value === "modified"
                    ? counts.modified
                    : counts.conflicts}
              </span>
            </button>
          ))}
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <p className="app-settings-help-note">{t("shortcuts.empty")}</p>
      ) : (
        visibleGroups.map((group) => (
          <SettingsCard
            key={group.category}
            title={t(
              group.category === "asset"
                ? "shortcuts.group.asset"
                : group.category === "folder"
                  ? "shortcuts.group.folder"
                  : group.category === "collection"
                    ? "shortcuts.group.collection"
                  : group.category === "viewer"
                    ? "shortcuts.group.viewer"
                    : "shortcuts.group.app",
            )}
          >
            <div className="shortcut-settings-list">
              {group.rows.map((row) => {
                const editing = editingActionId === row.action.id;
                const rowConflicts = row.conflicts;
                const displayChord = draftChord
                  ? formatShortcutChord(draftChord, platform, {
                      mouseBack: t("shortcuts.mouse.back"),
                      mouseForward: t("shortcuts.mouse.forward"),
                      wheel: t("shortcuts.mouse.wheel"),
                    })
                  : modifierPreview;
                return (
                  <div
                    className={`shortcut-settings-row${editing ? " is-recording" : ""}${rowConflicts.length > 0 ? " has-conflict" : ""}`}
                    key={row.action.id}
                  >
                    <div className="shortcut-settings-row-copy">
                      <div className="shortcut-settings-row-title">
                        <strong>{t(row.action.labelKey)}</strong>
                        {row.modified ? (
                          <span className="shortcut-settings-badge">
                            {t("shortcuts.modified")}
                          </span>
                        ) : null}
                      </div>
                      <span>{scopeLabel(row, t)}</span>
                    </div>
                    <div className="shortcut-settings-row-key">
                      {editing ? (
                        <div
                          aria-label={`${t(row.action.labelKey)} ${t("shortcuts.recording")}`}
                          aria-readonly="true"
                          className={`shortcut-capture-input${displayChord ? "" : " is-waiting"}${conflictDraft?.actionId === row.action.id ? " is-conflict" : ""}`}
                          ref={captureRef}
                          role="textbox"
                          tabIndex={0}
                        >
                          {displayChord || t("shortcuts.waitingForKeys")}
                        </div>
                      ) : (
                        <button
                          aria-label={`${t(row.action.labelKey)}: ${row.unassigned ? t("shortcuts.unassigned") : row.shortcutLabel}`}
                          className={`shortcut-keycap${row.unassigned ? " is-unassigned" : ""}`}
                          onClick={() => beginRecording(row.action.id)}
                          type="button"
                        >
                          {row.unassigned
                            ? t("shortcuts.unassigned")
                            : row.shortcutLabel}
                        </button>
                      )}
                      {!editing && rowConflicts.length > 0 ? (
                        <span className="shortcut-settings-badge is-conflict">
                          {t("shortcuts.filterConflicts")}
                        </span>
                      ) : null}
                    </div>
                    <div className="shortcut-settings-row-actions">
                      {editing ? (
                        <>
                          <IconActionButton
                            className="shortcut-settings-icon-button is-confirm"
                            disabled={
                              !draftChord ||
                              recorderError !== null ||
                              conflictDraft !== null ||
                              saving
                            }
                            icon="check"
                            label={t("shortcuts.accept")}
                            onClick={acceptDraft}
                            size={15}
                          />
                          <IconActionButton
                            className="shortcut-settings-icon-button"
                            icon="close"
                            label={t("shortcuts.cancel")}
                            onClick={cancelRecording}
                            size={14}
                          />
                          {!row.unassigned ? (
                            <IconActionButton
                              className="shortcut-settings-icon-button"
                              disabled={saving}
                              icon="trash"
                              label={t("shortcuts.clear")}
                              onClick={() => void clearBinding(row.action.id)}
                              size={14}
                            />
                          ) : null}
                        </>
                      ) : (
                        <>
                          <IconActionButton
                            className="shortcut-settings-icon-button"
                            icon="edit"
                            label={t("shortcuts.change")}
                            onClick={() => beginRecording(row.action.id)}
                            size={14}
                          />
                          {row.modified ? (
                            <IconActionButton
                              className="shortcut-settings-icon-button"
                              icon="undo"
                              label={t("shortcuts.reset")}
                              onClick={() => void resetRow(row.action.id)}
                              size={14}
                            />
                          ) : null}
                        </>
                      )}
                    </div>
                    {editing && conflictDraft?.actionId === row.action.id ? (
                      <div className="shortcut-row-feedback" role="alert">
                        {conflictDraft.conflicts.map((conflict) => (
                          <p
                            className="shortcut-row-error"
                            key={conflict.actionId}
                          >
                            {t("shortcuts.conflict", {
                              name: t(conflict.labelKey),
                            })}
                          </p>
                        ))}
                        {conflictDraft.conflicts.some(
                          (conflict) => !conflict.customizable,
                        ) ? (
                          <p className="shortcut-row-error">
                            {t("shortcuts.fixedConflictHint", {
                              name: t(
                                conflictDraft.conflicts.find(
                                  (conflict) => !conflict.customizable,
                                )?.labelKey ?? "",
                              ),
                            })}
                          </p>
                        ) : null}
                      </div>
                    ) : editing && recorderError !== null ? (
                      <p
                        className="shortcut-row-error shortcut-row-feedback"
                        role="alert"
                      >
                        {validationMessage(recorderError, t)}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </SettingsCard>
        ))
      )}

      <SettingsCard
        description={t("shortcuts.fixedDescription")}
        title={t("shortcuts.fixedTitle")}
      >
        <ul className="shortcut-fixed-list">
          {[
            "shortcuts.fixedWheel",
            "shortcuts.fixedCtrlWheel",
            "shortcuts.fixedMiddleDrag",
            "shortcuts.fixedEscape",
          ].map((key) => (
            <li key={key}>
              <span>{t(key)}</span>
              <span className="shortcut-settings-badge">
                {t("shortcuts.fixed")}
              </span>
            </li>
          ))}
        </ul>
      </SettingsCard>

      <div className="shortcut-settings-footer">
        <div className="shortcut-settings-file-actions">
          <button
            aria-label={t("shortcuts.import")}
            className="shortcut-settings-file-button"
            onClick={() => void handleImport()}
            type="button"
          >
            <Icon name="upload" size={13} />
            {t("shortcuts.import")}
          </button>
          <button
            aria-label={t("shortcuts.export")}
            className="shortcut-settings-file-button"
            onClick={() => void handleExport()}
            type="button"
          >
            <Icon name="download" size={13} />
            {t("shortcuts.export")}
          </button>
        </div>
        {confirmResetAll ? (
          <div className="shortcut-reset-confirm" role="alert">
            <span>
              {t("shortcuts.resetAllConfirm", { count: counts.modified })}
            </span>
            <button
              className="primary-button"
              disabled={saving}
              onClick={() => void confirmResetAllShortcuts()}
              type="button"
            >
              {t("shortcuts.resetConfirm")}
            </button>
            <button
              className="shortcut-settings-text-button is-muted"
              onClick={() => setConfirmResetAll(false)}
              type="button"
            >
              {t("shortcuts.cancel")}
            </button>
          </div>
        ) : (
          <button
            className="shortcut-settings-text-button is-muted"
            disabled={counts.modified === 0}
            onClick={() => setConfirmResetAll(true)}
            type="button"
          >
            {t("shortcuts.resetAll")}
          </button>
        )}
      </div>
    </div>
  );
}
