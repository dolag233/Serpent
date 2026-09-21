import { ipcRenderer } from 'electron';

import type { ApplicationMenuCommand, ApplicationMenuCommandEvent } from '../../shared/application-menu';
import {
  appLogAutomationCorrelationIdSchema,
  appLogFileNameSchema,
  parseAppLogEntry,
  type AppLogAutomationCorrelationId,
  type ReadAppLogResult,
} from '../../shared/app-log';
import type { BrowseKeyboardAction } from '../../shared/browse-keyboard-shortcuts';
import {
  commandCompletedPayloadSchema,
  type CommandCompletedPayload,
} from '../../shared/command-completed';
import { parseShowEditContextMenuResult } from '../../shared/edit-context-menu';
import {
  parseOpenExternalUrlResult,
  type RevealAppLogResult,
  type SerpentShellApi,
  type ShellSwipeDirection,
} from '../../shared/external-url';
import {
  parsePluginInputCapturePublishPayload,
  parsePluginInputCaptureSessionsPayload,
  type PluginInputCapturePublishPayload,
  type PluginInputCaptureRendererSession,
} from '../../shared/plugin-input-capture-renderer';
import {
  APPLICATION_MENU_COMMAND_CHANNEL,
  APPLICATION_MENU_ITEM_STATE_CHANNEL,
  APP_LOCALE_CHANNEL,
  BROWSE_SHORTCUT_CHANNEL,
  BROWSE_SHORTCUT_MENU_ENABLED_CHANNEL,
  COMMAND_COMPLETED_CHANNEL,
  COPY_SELECTION_CHANNEL,
  INVERT_SELECTION_CHANNEL,
  NATIVE_EDIT_COPY_CHANNEL,
  OPEN_EXTERNAL_URL_CHANNEL,
  PLUGIN_INPUT_CAPTURE_EVENT_CHANNEL,
  PLUGIN_INPUT_CAPTURE_SESSIONS_CHANNEL,
  PLUGIN_INPUT_CAPTURE_SYSTEM_MODAL_CHANNEL,
  READ_APP_LOG_CHANNEL,
  REVEAL_APP_LOG_CHANNEL,
  SHELL_NOTIFY_CHANNEL,
  SHELL_SWIPE_CHANNEL,
  SHOW_EDIT_CONTEXT_MENU_CHANNEL,
  VIEWER_VIDEO_SHORTCUTS_ACTIVE_CHANNEL,
  VIEWER_VIDEO_SHORTCUT_CHANNEL,
  WINDOW_CONTROL_CHANNEL,
  WINDOW_FOCUS_CHANNEL,
  WINDOW_MAXIMIZED_CHANNEL,
} from '../../shared/protocol/channels';
import { shellNotifyPayloadSchema, type ShellNotifyPayload } from '../../shared/shell-notify';
import type { ViewerVideoShortcutAction } from '../../shared/viewer-video-shortcuts';
import {
  parseWindowControlResult,
  parseWindowMaximizedStateEvent,
  type WindowControlAction,
} from '../../shared/window-controls';

export function parseRevealAppLogResult(input: unknown): RevealAppLogResult {
  if (
    typeof input === 'object' &&
    input !== null &&
    'ok' in input &&
    (input as { ok: unknown }).ok === true
  ) {
    return { ok: true };
  }
  const code =
    typeof input === 'object' &&
    input !== null &&
    'code' in input &&
    typeof (input as { code: unknown }).code === 'string'
      ? (input as { code: string }).code
      : 'shell_failure';
  if (
    code === 'unauthorized_sender' ||
    code === 'log_missing' ||
    code === 'shell_failure'
  ) {
    return { ok: false, code };
  }
  return { ok: false, code: 'shell_failure' };
}

export function parseReadAppLogResult(input: unknown): ReadAppLogResult {
  if (typeof input === 'object' && input !== null && 'ok' in input && (input as { ok: unknown }).ok === true) {
    const value = input as { entries?: unknown; fileName?: unknown };
    if (
      typeof value.fileName === 'string' &&
      appLogFileNameSchema.safeParse(value.fileName).success &&
      Array.isArray(value.entries)
    ) {
      const entries = value.entries.flatMap((entry) => {
        const parsed = parseAppLogEntry(entry);
        return parsed ? [parsed] : [];
      });
      return { ok: true, entries, fileName: value.fileName };
    }
  }
  const code =
    typeof input === 'object' && input !== null && 'code' in input && typeof (input as { code: unknown }).code === 'string'
      ? (input as { code: string }).code
      : 'read_failure';
  if (code === 'unauthorized_sender' || code === 'malformed_request' || code === 'log_missing' || code === 'read_failure') {
    return { ok: false, code };
  }
  return { ok: false, code: 'read_failure' };
}

export const shell: SerpentShellApi = Object.freeze({
  async openExternalUrl(url: string) {
    const result: unknown = await ipcRenderer.invoke(OPEN_EXTERNAL_URL_CHANNEL, { url });
    return parseOpenExternalUrlResult(result);
  },
  async revealAppLog() {
    const result: unknown = await ipcRenderer.invoke(REVEAL_APP_LOG_CHANNEL);
    return parseRevealAppLogResult(result);
  },
  async readAppLog(automationCorrelationId?: AppLogAutomationCorrelationId): Promise<ReadAppLogResult> {
    const parsedCorrelationId = automationCorrelationId === undefined
      ? undefined
      : appLogAutomationCorrelationIdSchema.safeParse(automationCorrelationId);
    if (parsedCorrelationId !== undefined && !parsedCorrelationId.success) {
      return { ok: false, code: 'malformed_request' };
    }
    const result: unknown = await ipcRenderer.invoke(
      READ_APP_LOG_CHANNEL,
      parsedCorrelationId === undefined ? undefined : { automationCorrelationId: parsedCorrelationId.data },
    );
    return parseReadAppLogResult(result);
  },
  setAppLocale(locale: 'zh-CN' | 'en'): void {
    ipcRenderer.send(APP_LOCALE_CHANNEL, { locale });
  },
  async showEditContextMenu(point: { x: number; y: number }) {
    const result: unknown = await ipcRenderer.invoke(
      SHOW_EDIT_CONTEXT_MENU_CHANNEL,
      point,
    );
    return parseShowEditContextMenuResult(result);
  },
  async windowControl(action: WindowControlAction) {
    const result: unknown = await ipcRenderer.invoke(WINDOW_CONTROL_CHANNEL, {
      action,
    });
    return parseWindowControlResult(result);
  },
  onWindowMaximizedChanged(listener: (maximized: boolean) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = parseWindowMaximizedStateEvent(input);
      if (parsed) listener(parsed.maximized);
    };
    ipcRenderer.on(WINDOW_MAXIMIZED_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(WINDOW_MAXIMIZED_CHANNEL, handler);
    };
  },
  onSwipe(listener: (direction: ShellSwipeDirection) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, direction: unknown) => {
      if (
        direction === 'left' ||
        direction === 'right' ||
        direction === 'up' ||
        direction === 'down'
      ) {
        listener(direction);
      }
    };
    ipcRenderer.on(SHELL_SWIPE_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(SHELL_SWIPE_CHANNEL, handler);
    };
  },
  onWindowFocusChanged(listener: (focused: boolean) => void) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'focused' in payload &&
        typeof (payload as { focused: unknown }).focused === 'boolean'
      ) {
        listener((payload as { focused: boolean }).focused);
      }
    };
    ipcRenderer.on(WINDOW_FOCUS_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(WINDOW_FOCUS_CHANNEL, handler);
    };
  },
  onInvertSelection(listener: () => void): () => void {
    const handler = () => {
      listener();
    };
    ipcRenderer.on(INVERT_SELECTION_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(INVERT_SELECTION_CHANNEL, handler);
    };
  },
  onShellNotify(listener: (input: ShellNotifyPayload) => void) {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = shellNotifyPayloadSchema.safeParse(input);
      if (!parsed.success) return;
      listener(parsed.data);
    };
    ipcRenderer.on(SHELL_NOTIFY_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(SHELL_NOTIFY_CHANNEL, handler);
    };
  },
  onCommandCompleted(listener: (payload: CommandCompletedPayload) => void) {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = commandCompletedPayloadSchema.safeParse(input);
      if (!parsed.success) return;
      listener(parsed.data);
    };
    ipcRenderer.on(COMMAND_COMPLETED_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(COMMAND_COMPLETED_CHANNEL, handler);
    };
  },
  onCopySelection(listener: () => void): () => void {
    const handler = () => {
      listener();
    };
    ipcRenderer.on(COPY_SELECTION_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(COPY_SELECTION_CHANNEL, handler);
    };
  },
  onApplicationMenuCommand(listener: (event: ApplicationMenuCommandEvent) => void): () => void {
    const commands: readonly ApplicationMenuCommand[] = [
      'invert-selection', 'copy-selection',
      'file.import-files', 'file.import-folder', 'file.import-linked-folder',
      'edit.undo', 'edit.redo', 'edit.paste', 'edit.select-all', 'edit.clear-selection',
      'library.create', 'library.open', 'library.open-recent', 'library.close', 'library.remove',
      'library.delete-from-disk', 'library.import', 'library.import-eagle', 'library.export', 'library.settings',
      'window.background-jobs', 'window.diagnostics',
      'about.serpent', 'about.github', 'about.open-source', 'about.diagnostics', 'settings',
    ];
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      // Items with a payload arrive as { command, payload }.
      if (typeof input === 'string') {
        if (commands.includes(input as ApplicationMenuCommand)) {
          listener({ command: input as ApplicationMenuCommand });
        }
        return;
      }
      if (typeof input !== 'object' || input === null) return;
      const { command, payload } = input as { command?: unknown; payload?: unknown };
      if (typeof command !== 'string') return;
      if (!commands.includes(command as ApplicationMenuCommand)) return;
      listener({
        command: command as ApplicationMenuCommand,
        ...(typeof payload === 'string' ? { payload } : {}),
      });
    };
    ipcRenderer.on(APPLICATION_MENU_COMMAND_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(APPLICATION_MENU_COMMAND_CHANNEL, handler);
    };
  },
  setApplicationMenuCommandEnabled(command: ApplicationMenuCommand, enabled: boolean): void {
    // Best-effort: the native menu may be absent (Windows hides it).
    void ipcRenderer.invoke(APPLICATION_MENU_ITEM_STATE_CHANNEL, { command, enabled })
      .catch(() => undefined);
  },
  setApplicationMenuCommandLabel(command: ApplicationMenuCommand, label: string): void {
    if (label.length === 0 || label.length > 200) return;
    void ipcRenderer.invoke(APPLICATION_MENU_ITEM_STATE_CHANNEL, { command, label })
      .catch(() => undefined);
  },
  async nativeEditCopy(): Promise<void> {
    await ipcRenderer.invoke(NATIVE_EDIT_COPY_CHANNEL);
  },
  setViewerVideoShortcutsActive(active: boolean): void {
    ipcRenderer.send(VIEWER_VIDEO_SHORTCUTS_ACTIVE_CHANNEL, { active: Boolean(active) });
  },
  setBrowseShortcutAcceleratorsEnabled(enabled: boolean): void {
    ipcRenderer.send(BROWSE_SHORTCUT_MENU_ENABLED_CHANNEL, { enabled: Boolean(enabled) });
  },
  onBrowseShortcut(listener: (action: BrowseKeyboardAction) => void): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { action?: string },
    ) => {
      const action = payload?.action;
      if (action === 'rename' || action === 'trash' || action === 'disk-delete') {
        listener(action);
      }
    };
    ipcRenderer.on(BROWSE_SHORTCUT_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(BROWSE_SHORTCUT_CHANNEL, handler);
    };
  },
  onViewerVideoShortcut(listener: (action: ViewerVideoShortcutAction) => void): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { action?: string },
    ) => {
      const action = payload?.action;
      if (
        action === 'frame-prev' ||
        action === 'frame-next' ||
        action === 'rate-slower' ||
        action === 'rate-faster'
      ) {
        listener(action);
      }
    };
    ipcRenderer.on(VIEWER_VIDEO_SHORTCUT_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(VIEWER_VIDEO_SHORTCUT_CHANNEL, handler);
    };
  },
  onInputCaptureSessions(listener: (sessions: PluginInputCaptureRendererSession[]) => void) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      const parsed = parsePluginInputCaptureSessionsPayload(payload);
      if (parsed === null) return;
      listener(parsed.sessions);
    };
    ipcRenderer.on(PLUGIN_INPUT_CAPTURE_SESSIONS_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(PLUGIN_INPUT_CAPTURE_SESSIONS_CHANNEL, handler);
    };
  },
  publishInputCaptureEvent(payload: PluginInputCapturePublishPayload) {
    const parsed = parsePluginInputCapturePublishPayload(payload);
    if (parsed === null) return;
    ipcRenderer.send(PLUGIN_INPUT_CAPTURE_EVENT_CHANNEL, parsed);
  },
  setInputCaptureSystemModalActive(active: boolean) {
    ipcRenderer.send(PLUGIN_INPUT_CAPTURE_SYSTEM_MODAL_CHANNEL, { active: Boolean(active) });
  },
});
