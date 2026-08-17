import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  SCRIPT_SANDBOX_PREVIEW_MAX_SOURCE_BYTES,
  utf8ByteLength,
} from '../shared/script-sandbox-limits';
import type {
  AutomationScriptFileResult,
  AutomationScriptHistoryEntry,
  AutomationRecentScriptEntry,
  AutomationScriptRuntimeFailureCode,
  SerpentAutomationScriptApi,
} from '../shared/automation-script-api';
import { Icon } from './Icons';
import { iconActionAttrs } from './icon-action-attrs';
import { useT } from './i18n';
import { DialogShell } from './ui/patterns';

type PreviewResult =
  | { kind: 'completed'; value: unknown; output: string[]; logId: string }
  | { kind: 'failed'; code: AutomationScriptRuntimeFailureCode; message: string; logId?: string }
  | null;

type SavedScript = Extract<AutomationScriptFileResult, { ok: true }>;

function formatValue(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested === 'bigint') return `${nested}n`;
    if (typeof nested === 'object' && nested !== null) {
      if (seen.has(nested)) return '[Circular]';
      seen.add(nested);
    }
    return nested;
  }, 2);
  return serialized === undefined ? String(value) : serialized;
}

function errorMessageKey(code: AutomationScriptRuntimeFailureCode): string {
  return `automation.preview.errors.${code}`;
}

function historyStatusLabel(
  status: string,
  t: ReturnType<typeof useT>,
): string {
  switch (status) {
    case 'succeeded':
      return t('automation.preview.historyStatus.succeeded');
    case 'failed':
      return t('automation.preview.historyStatus.failed');
    case 'cancelled':
      return t('automation.preview.historyStatus.cancelled');
    case 'timed-out':
      return t('automation.preview.historyStatus.timedOut');
    case 'running':
      return t('automation.preview.historyStatus.running');
    case 'awaiting-authorization':
      return t('automation.preview.historyStatus.awaitingAuthorization');
    case 'awaiting-approval':
      return t('automation.preview.historyStatus.awaitingApproval');
    default:
      return status;
  }
}

function historySourceLabel(
  source: AutomationScriptHistoryEntry['source'],
  t: ReturnType<typeof useT>,
): string {
  switch (source) {
    case 'desktop-console':
      return t('automation.preview.historySource.console');
    case 'script':
      return t('automation.preview.historySource.script');
    case 'mcp':
      return t('automation.preview.historySource.mcp');
    case 'plugin':
      return t('automation.preview.historySource.plugin');
    default:
      return t('automation.preview.historySource.test');
  }
}

export function ScriptSandboxPreviewDialog({
  open,
  onClose,
  onExecutionSettled,
  onOpenExecutionLog,
  libraryId,
  automation,
}: {
  open: boolean;
  onClose(): void;
  /**
   * A script may have applied one or more writes before it returns or throws.
   * The App refreshes the active view once per settled execution instead of
   * reloading for every command/batch inside the script.
   */
  onExecutionSettled?(): void | Promise<void>;
  /** Opens the existing diagnostics surface scoped to this run's log ID. */
  onOpenExecutionLog?(logId: string): void;
  libraryId: string | null;
  automation: SerpentAutomationScriptApi | undefined;
}): ReactNode {
  const t = useT();
  const executionIdRef = useRef<string | null>(null);
  const onExecutionSettledRef = useRef(onExecutionSettled);
  const [source, setSource] = useState('');
  const [savedScript, setSavedScript] = useState<SavedScript | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PreviewResult>(null);
  const [scriptFileMessage, setScriptFileMessage] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<AutomationScriptHistoryEntry[]>([]);
  const [recentScripts, setRecentScripts] = useState<AutomationRecentScriptEntry[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [completedExecutionId, setCompletedExecutionId] = useState<string | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);

  useEffect(() => {
    onExecutionSettledRef.current = onExecutionSettled;
  }, [onExecutionSettled]);

  useEffect(() => {
    if (!open || !automation) return;
    let cancelled = false;
    void automation.recentList().then((recent) => {
      if (cancelled || !recent.ok) return;
      setRecentScripts(recent.entries);
    }).catch(() => {
      if (!cancelled) setRecentScripts([]);
    });
    return () => {
      cancelled = true;
    };
  }, [open, automation, savedScript]);

  useEffect(() => {
    if (!open || !libraryId || !automation) return;
    let cancelled = false;
    void automation.history({ libraryId, limit: 12 }).then((history) => {
      if (cancelled || !history.ok) return;
      setHistoryEntries(history.entries);
    }).catch(() => {
      if (!cancelled) setHistoryEntries([]);
    });
    return () => {
      cancelled = true;
    };
  }, [open, libraryId, automation, result]);

  if (!open) return null;

  const run = async (): Promise<void> => {
    if (source.trim() === '') {
      setResult({
        kind: 'failed',
        code: 'SOURCE_NOT_ALLOWED',
        message: t('automation.preview.emptySource'),
      });
      return;
    }
    if (utf8ByteLength(source) > SCRIPT_SANDBOX_PREVIEW_MAX_SOURCE_BYTES) {
      setResult({
        kind: 'failed',
        code: 'SOURCE_TOO_LARGE',
        message: t('automation.preview.errors.SOURCE_TOO_LARGE'),
      });
      return;
    }
    if (!automation) {
      setResult({
        kind: 'failed',
        code: 'RUNTIME_ERROR',
        message: 'The automation service is unavailable.',
      });
      return;
    }
    setResult(null);
    setCompletedExecutionId(null);
    setUndoMessage(null);
    setScriptFileMessage(null);
    let started;
    try {
      started = await automation.start({
        libraryId,
        source,
        ...(savedScript === null ? {} : { scriptId: savedScript.scriptId }),
      });
    } catch {
      setResult({
        kind: 'failed',
        code: 'RUNTIME_ERROR',
        message: 'The automation service could not start this script.',
      });
      return;
    }
    if (!started.ok) {
      setCapabilities([]);
      setResult({
        kind: 'failed',
        code: 'RUNTIME_ERROR',
        message: started.error.message,
      });
      return;
    }
    executionIdRef.current = started.executionId;
    setCapabilities(started.capabilities);
    setRunning(true);
    try {
      const executed = await automation.execute({ executionId: started.executionId });
      if (!executed.ok) {
        setResult({
          kind: 'failed',
          code: executed.error.code,
          message: executed.error.message,
          logId: started.logId,
        });
      } else {
        setCompletedExecutionId(started.executionId);
        setResult({
          kind: 'completed',
          value: executed.value,
          output: executed.output,
          logId: started.logId,
        });
      }
    } catch {
      setResult({
        kind: 'failed',
        code: 'RUNTIME_ERROR',
        message: 'The isolated script runtime could not complete.',
        logId: started.logId,
      });
    } finally {
      if (executionIdRef.current === started.executionId) {
        executionIdRef.current = null;
        setRunning(false);
      }
      // A timeout, crash, or cancellation may follow an earlier write. Refresh
      // once after every terminal UtilityProcess outcome, not only success.
      void onExecutionSettledRef.current?.();
    }
  };

  const close = (): void => {
    const executionId = executionIdRef.current;
    if (executionId) void automation?.cancel({ executionId });
    onClose();
  };

  const stop = (): void => {
    const executionId = executionIdRef.current;
    if (executionId) void automation?.cancel({ executionId });
  };
  const undo = async (): Promise<void> => {
    if (!automation || !completedExecutionId) return;
    const undone = await automation.undo({ executionId: completedExecutionId });
    if (!undone.ok) {
      setUndoMessage(undone.error.message);
      return;
    }
    setCompletedExecutionId(null);
    setUndoMessage(t('automation.preview.undoDone', { count: undone.undoneCount }));
    void onExecutionSettledRef.current?.();
  };
  const resultLogId = result?.logId;

  const reportScriptFileResult = (file: AutomationScriptFileResult): SavedScript | null => {
    if (file.ok) {
      setScriptFileMessage(null);
      return file;
    }
    const messageKey = `automation.preview.fileErrors.${file.code}`;
    setScriptFileMessage(t(messageKey));
    return null;
  };

  const refreshRecentScripts = async (): Promise<void> => {
    if (!automation) return;
    const recent = await automation.recentList();
    if (recent.ok) setRecentScripts(recent.entries);
  };

  const applyOpenedScript = (opened: SavedScript): void => {
    setSource(opened.source);
    setSavedScript(opened);
    setResult(null);
    setScriptFileMessage(null);
  };

  const openScript = async (): Promise<void> => {
    if (!automation || running) return;
    try {
      const opened = reportScriptFileResult(await automation.open());
      if (!opened) return;
      applyOpenedScript(opened);
      await refreshRecentScripts();
    } catch {
      setScriptFileMessage(t('automation.preview.fileErrors.io-failed'));
    }
  };

  const openRecentScript = async (handle: string): Promise<void> => {
    if (!automation || running) return;
    try {
      const opened = reportScriptFileResult(await automation.openRecent({ handle }));
      if (!opened) return;
      applyOpenedScript(opened);
      await refreshRecentScripts();
    } catch {
      setScriptFileMessage(t('automation.preview.fileErrors.io-failed'));
    }
  };

  const saveScript = async (): Promise<void> => {
    if (!automation || running) return;
    if (source.trim() === '') {
      setScriptFileMessage(t('automation.preview.emptySource'));
      return;
    }
    try {
      const saved = reportScriptFileResult(await automation.save({ source }));
      if (!saved) return;
      setSource(saved.source);
      setSavedScript(saved);
      await refreshRecentScripts();
    } catch {
      setScriptFileMessage(t('automation.preview.fileErrors.io-failed'));
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      role="presentation"
    >
      <DialogShell
        className="create-dialog script-sandbox-preview-dialog"
        dialogId="script-sandbox-preview"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void run();
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
            const target = event.target as HTMLElement;
            const editable = target.isContentEditable
              || target.tagName === 'INPUT'
              || target.tagName === 'TEXTAREA'
              || target.tagName === 'SELECT';
            if (!editable && completedExecutionId) {
              event.preventDefault();
              void undo();
            }
          }
        }}
        onRequestClose={close}
        style={{ padding: 0 }}
        title={
          <>
            <span className="micro-label">{t('automation.preview.badge')}</span>{' '}
            {t('automation.preview.title')}
          </>
        }
        headerActions={
          <button
            className="dialog-close"
            onClick={close}
            type="button"
            {...iconActionAttrs(t('common.close'))}
          >
            <Icon name="close" size={16} />
          </button>
        }
      >
        <label className="script-sandbox-preview-label" htmlFor="script-sandbox-preview-source">
          {t('automation.preview.sourceLabel')}
        </label>
        {savedScript ? (
          <p className="field-help script-sandbox-preview-file-name">
            {t('automation.preview.savedFile')}{savedScript.displayName}
          </p>
        ) : null}
        <textarea
          autoCapitalize="off"
          autoCorrect="off"
          className="script-sandbox-preview-editor"
          id="script-sandbox-preview-source"
          onChange={(event) => {
            setSource(event.target.value);
            setSavedScript(null);
            setScriptFileMessage(null);
          }}
          placeholder={t('automation.preview.sourcePlaceholder')}
          spellCheck={false}
          value={source}
        />
        <p className="field-help script-sandbox-preview-scope">
          {libraryId === null
            ? t('automation.preview.unboundLibrary')
            : t('automation.preview.boundLibrary')}
        </p>
        {capabilities.length > 0 ? (
          <p
            className="field-help script-sandbox-preview-capabilities"
            title={capabilities.join(', ')}
          >
            {t('automation.preview.capabilities')}{capabilities.length}
          </p>
        ) : null}
        {scriptFileMessage ? <p className="field-help script-sandbox-preview-file-error">{scriptFileMessage}</p> : null}

        <div className="script-sandbox-preview-recent">
          <p className="script-sandbox-preview-result-title">{t('automation.preview.recentScriptsTitle')}</p>
          {recentScripts.length === 0 ? (
            <p className="field-help">{t('automation.preview.recentScriptsEmpty')}</p>
          ) : (
            <ul className="script-sandbox-preview-recent-list">
              {recentScripts.map((entry) => (
                <li key={entry.handle}>
                  <button
                    className="linkish-button"
                    disabled={running}
                    onClick={() => void openRecentScript(entry.handle)}
                    type="button"
                  >
                    {entry.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          aria-live="polite"
          className="script-sandbox-preview-result"
          data-state={running ? 'running' : result?.kind ?? 'idle'}
        >
          {running ? <p>{t('automation.preview.running')}</p> : null}
          {!running && result?.kind === 'completed' ? (
            <>
              <p className="script-sandbox-preview-result-title">{t('automation.preview.completed')}</p>
              <pre>{formatValue(result.value)}</pre>
              {result.output.length > 0 ? (
                <>
                  <p className="script-sandbox-preview-output-label">{t('automation.preview.output')}</p>
                  <pre>{result.output.join('\n')}</pre>
                </>
              ) : null}
            </>
          ) : null}
          {!running && result?.kind === 'completed' && completedExecutionId ? (
            <div className="script-sandbox-preview-undo">
              <p>{t('automation.preview.undoAvailable')}</p>
              <button className="secondary-button" onClick={() => void undo()} type="button">
                {t('automation.preview.undo')}
              </button>
            </div>
          ) : null}
          {undoMessage ? <p className="field-help">{undoMessage}</p> : null}
          {!running && result?.kind === 'failed' ? (
            <>
              <p className="script-sandbox-preview-result-title">{result.code}</p>
              <pre>{result.message || t(errorMessageKey(result.code))}</pre>
            </>
          ) : null}
          {!running && !result ? <p>{t('automation.preview.ready')}</p> : null}
        </div>

        <div className="script-sandbox-preview-history">
          <p className="script-sandbox-preview-result-title">{t('automation.preview.historyTitle')}</p>
          {historyEntries.length === 0 ? (
            <p className="field-help">{t('automation.preview.historyEmpty')}</p>
          ) : (
            <ul className="script-sandbox-preview-history-list">
              {historyEntries.map((entry) => (
                <li key={entry.executionId}>
                  <span className="script-sandbox-preview-history-status">
                    {historyStatusLabel(entry.status, t)}
                  </span>
                  <span className="script-sandbox-preview-history-source">
                    {historySourceLabel(entry.source, t)}
                  </span>
                  <span className="script-sandbox-preview-history-count">
                    {entry.succeededCommandCount}/{entry.commandCount}
                  </span>
                  {onOpenExecutionLog ? (
                    <button
                      className="script-sandbox-preview-history-action"
                      onClick={() => onOpenExecutionLog(entry.logId)}
                      type="button"
                    >
                      {t('automation.preview.openRunLog')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dialog-actions">
          <button className="secondary-button" disabled={running} onClick={() => void openScript()} type="button">
            {t('automation.preview.openScript')}
          </button>
          <button className="secondary-button" disabled={running} onClick={() => void saveScript()} type="button">
            {t('automation.preview.saveScript')}
          </button>
          {running ? (
            <button className="secondary-button" onClick={stop} type="button">
              {t('automation.preview.stop')}
            </button>
          ) : null}
          {!running && resultLogId && onOpenExecutionLog ? (
            <button className="secondary-button" onClick={() => onOpenExecutionLog(resultLogId)} type="button">
              {t('automation.preview.openRunLog')}
            </button>
          ) : null}
          <button className="primary-button" disabled={running} onClick={() => void run()} type="button">
            {t('automation.preview.run')}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
