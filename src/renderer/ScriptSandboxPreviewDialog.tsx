import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  SCRIPT_SANDBOX_PREVIEW_MAX_SOURCE_BYTES,
  utf8ByteLength,
} from '../shared/script-sandbox-limits';
import type {
  AutomationScriptRuntimeFailureCode,
  SerpentAutomationScriptApi,
} from '../shared/automation-script-api';
import { Icon } from './Icons';
import { iconActionAttrs } from './icon-action-attrs';
import { useT } from './i18n';
import { DEFAULT_AUTOMATION_RATING_SCRIPT } from './script-sandbox-preview-default';

type PreviewResult =
  | { kind: 'completed'; value: unknown; output: string[] }
  | { kind: 'failed'; code: AutomationScriptRuntimeFailureCode; message: string }
  | null;

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

export function ScriptSandboxPreviewDialog({
  open,
  onClose,
  onExecutionSettled,
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
  libraryId: string | null;
  automation: SerpentAutomationScriptApi | undefined;
}): ReactNode {
  const t = useT();
  const executionIdRef = useRef<string | null>(null);
  const onExecutionSettledRef = useRef(onExecutionSettled);
  const [source, setSource] = useState(DEFAULT_AUTOMATION_RATING_SCRIPT);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PreviewResult>(null);

  useEffect(() => {
    onExecutionSettledRef.current = onExecutionSettled;
  }, [onExecutionSettled]);

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
    if (!libraryId || !automation) {
      setResult({
        kind: 'failed',
        code: 'RUNTIME_ERROR',
        message: 'Open a library before running an automation script.',
      });
      return;
    }
    setResult(null);
    let started;
    try {
      started = await automation.start({ libraryId, source });
    } catch {
      setResult({
        kind: 'failed',
        code: 'RUNTIME_ERROR',
        message: 'The automation service could not start this script.',
      });
      return;
    }
    if (!started.ok) {
      setResult({
        kind: 'failed',
        code: 'RUNTIME_ERROR',
        message: started.error.message,
      });
      return;
    }
    executionIdRef.current = started.executionId;
    setRunning(true);
    try {
      const executed = await automation.execute({ executionId: started.executionId });
      if (!executed.ok) {
        setResult({ kind: 'failed', code: executed.error.code, message: executed.error.message });
      } else {
        setResult({ kind: 'completed', value: executed.value, output: executed.output });
      }
    } catch {
      setResult({
        kind: 'failed',
        code: 'RUNTIME_ERROR',
        message: 'The isolated script runtime could not complete.',
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

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      role="presentation"
    >
      <section
        aria-describedby="script-sandbox-preview-description"
        aria-labelledby="script-sandbox-preview-title"
        aria-modal="true"
        className="create-dialog script-sandbox-preview-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void run();
          }
        }}
        role="dialog"
      >
        <div className="dialog-heading script-sandbox-preview-heading">
          <div>
            <p className="micro-label">{t('automation.preview.badge')}</p>
            <h2 id="script-sandbox-preview-title">{t('automation.preview.title')}</h2>
            <p className="script-sandbox-preview-description" id="script-sandbox-preview-description">
              {t('automation.preview.description')}
            </p>
          </div>
          <button
            className="dialog-close"
            onClick={close}
            type="button"
            {...iconActionAttrs(t('common.close'))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <label className="script-sandbox-preview-label" htmlFor="script-sandbox-preview-source">
          {t('automation.preview.sourceLabel')}
        </label>
        <textarea
          autoCapitalize="off"
          autoCorrect="off"
          className="script-sandbox-preview-editor"
          id="script-sandbox-preview-source"
          onChange={(event) => setSource(event.target.value)}
          placeholder={t('automation.preview.sourcePlaceholder')}
          spellCheck={false}
          value={source}
        />
        <p className="field-help script-sandbox-preview-help">
          {t('automation.preview.bridgeHint')}
        </p>

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
          {!running && result?.kind === 'failed' ? (
            <>
              <p className="script-sandbox-preview-result-title">{result.code}</p>
              <pre>{result.message || t(errorMessageKey(result.code))}</pre>
            </>
          ) : null}
          {!running && !result ? <p>{t('automation.preview.ready')}</p> : null}
        </div>

        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={running}
            onClick={() => {
              setSource(DEFAULT_AUTOMATION_RATING_SCRIPT);
              setResult(null);
            }}
            type="button"
          >
            {t('automation.preview.reset')}
          </button>
          {running ? (
            <button className="secondary-button" onClick={stop} type="button">
              {t('automation.preview.stop')}
            </button>
          ) : null}
          <button className="primary-button" disabled={running} onClick={() => void run()} type="button">
            {t('automation.preview.run')}
          </button>
        </div>
      </section>
    </div>
  );
}
