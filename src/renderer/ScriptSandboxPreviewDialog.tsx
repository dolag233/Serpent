import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { QuickJsSandboxPrototypeErrorCode } from '../scripting/quickjs-sandbox-prototype';
import {
  SCRIPT_SANDBOX_PREVIEW_MAX_SOURCE_BYTES,
  utf8ByteLength,
} from '../shared/script-sandbox-limits';
import type { SerpentAutomationScriptApi } from '../shared/automation-script-api';
import { Icon } from './Icons';
import { iconActionAttrs } from './icon-action-attrs';
import { useT } from './i18n';
import { DEFAULT_AUTOMATION_RATING_SCRIPT } from './script-sandbox-preview-default';
import {
  createScriptSandboxPreviewController,
  type ScriptSandboxPreviewController,
  type ScriptSandboxPreviewWorker,
} from './script-sandbox-preview-controller';
import type {
  ScriptSandboxPreviewWorkerCompleted,
  ScriptSandboxPreviewWorkerFailed,
} from './script-sandbox-preview-protocol';

type PreviewResult =
  | { kind: 'completed'; message: ScriptSandboxPreviewWorkerCompleted }
  | { kind: 'failed'; message: ScriptSandboxPreviewWorkerFailed }
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

function errorMessageKey(code: QuickJsSandboxPrototypeErrorCode): string {
  return `automation.preview.errors.${code}`;
}

function createPreviewWorker(): ScriptSandboxPreviewWorker {
  return new Worker(
    new URL('./script-sandbox-preview.worker.ts', import.meta.url),
    { type: 'module' },
  ) as unknown as ScriptSandboxPreviewWorker;
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
  const controllerRef = useRef<ScriptSandboxPreviewController | null>(null);
  const executionIdRef = useRef<string | null>(null);
  const onExecutionSettledRef = useRef(onExecutionSettled);
  const [source, setSource] = useState(DEFAULT_AUTOMATION_RATING_SCRIPT);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PreviewResult>(null);

  useEffect(() => {
    onExecutionSettledRef.current = onExecutionSettled;
  }, [onExecutionSettled]);

  useEffect(() => {
    if (!open) return;
    const controller = createScriptSandboxPreviewController({
      createWorker: createPreviewWorker,
      newRunId: () => crypto.randomUUID(),
      onCompleted: (message) => {
        const executionId = executionIdRef.current;
        executionIdRef.current = null;
        if (executionId) void automation?.complete({ executionId, succeeded: true });
        setResult({ kind: 'completed', message });
        void onExecutionSettledRef.current?.();
      },
      onFailed: (message) => {
        const executionId = executionIdRef.current;
        executionIdRef.current = null;
        if (executionId) void automation?.complete({ executionId, succeeded: false });
        setResult({ kind: 'failed', message });
        // A timeout or runtime error can occur after an earlier script command
        // mutated the library, so stale cards and Inspector state must refresh
        // on every terminal outcome, not only a successful return.
        void onExecutionSettledRef.current?.();
      },
      onStateChange: (state) => setRunning(state === 'running'),
      onAutomationCommand: async (message) => {
        const executionId = executionIdRef.current;
        if (!automation || !executionId) {
          return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The automation execution is unavailable.' } };
        }
        return automation.command({
          executionId,
          commandId: message.commandId,
          input: message.input,
        });
      },
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [automation, open]);

  if (!open) return null;

  const run = async (): Promise<void> => {
    if (source.trim() === '') {
      setResult({
        kind: 'failed',
        message: {
          type: 'failed',
          runId: 'local',
          code: 'SOURCE_NOT_ALLOWED',
          message: t('automation.preview.emptySource'),
        },
      });
      return;
    }
    if (utf8ByteLength(source) > SCRIPT_SANDBOX_PREVIEW_MAX_SOURCE_BYTES) {
      setResult({
        kind: 'failed',
        message: {
          type: 'failed',
          runId: 'local',
          code: 'SOURCE_TOO_LARGE',
          message: t('automation.preview.errors.SOURCE_TOO_LARGE'),
        },
      });
      return;
    }
    if (!libraryId || !automation) {
      setResult({
        kind: 'failed',
        message: {
          type: 'failed', runId: 'local', code: 'RUNTIME_ERROR',
          message: 'Open a library before running an automation script.',
        },
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
        message: {
          type: 'failed', runId: 'local', code: 'RUNTIME_ERROR',
          message: 'The automation service could not start this script.',
        },
      });
      return;
    }
    if (!started.ok) {
      setResult({
        kind: 'failed',
        message: { type: 'failed', runId: 'local', code: 'RUNTIME_ERROR', message: started.error.message },
      });
      return;
    }
    executionIdRef.current = started.executionId;
    controllerRef.current?.run(source);
  };

  const close = (): void => {
    const executionId = executionIdRef.current;
    executionIdRef.current = null;
    if (executionId) void automation?.cancel({ executionId });
    controllerRef.current?.stop();
    onClose();
  };

  const stop = (): void => {
    const executionId = executionIdRef.current;
    executionIdRef.current = null;
    if (executionId) void automation?.cancel({ executionId });
    controllerRef.current?.stop();
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
              <pre>{formatValue(result.message.value)}</pre>
              {result.message.output.length > 0 ? (
                <>
                  <p className="script-sandbox-preview-output-label">{t('automation.preview.output')}</p>
                  <pre>{result.message.output.join('\n')}</pre>
                </>
              ) : null}
            </>
          ) : null}
          {!running && result?.kind === 'failed' ? (
            <>
              <p className="script-sandbox-preview-result-title">{result.message.code}</p>
              <pre>{t(errorMessageKey(result.message.code))}</pre>
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
