export const LIBRARY_REQUEST_CHANNEL = 'serpent:library:request' as const;
export const LIBRARY_LIFECYCLE_CHANNEL = 'serpent:library:lifecycle' as const;
export const ASSET_CHANGE_CHANNEL = 'serpent:asset:changed' as const;
export const THUMBNAIL_CHANNEL = 'serpent:thumbnail' as const;
export const PROGRESS_CHANNEL = 'serpent:progress' as const;
export const AI_PROGRESS_CHANNEL = 'serpent:ai:progress' as const;
export const AI_COMPLETED_CHANNEL = 'serpent:ai:completed' as const;
export const AI_CLEARED_CHANNEL = 'serpent:ai:cleared' as const;

export const EXTENSION_SAVE_COMPLETED_CHANNEL =
  'serpent:extension:save-completed' as const;
export const ACTIVE_CONTEXT_CHANNEL = 'serpent:active-context' as const;
/** Renderer → Main: effective UI locale for native dialogs (Serpent-bwb). */
export const APP_LOCALE_CHANNEL = 'serpent:app-locale' as const;
export const OPEN_EXTERNAL_URL_CHANNEL = 'serpent:shell:open-external-url' as const;
export const REVEAL_APP_LOG_CHANNEL = 'serpent:shell:reveal-app-log' as const;
export const READ_APP_LOG_CHANNEL = 'serpent:shell:read-app-log' as const;
export const SHOW_EDIT_CONTEXT_MENU_CHANNEL =
  'serpent:shell:show-edit-context-menu' as const;
export const SHELL_SWIPE_CHANNEL = 'serpent:shell:swipe' as const;
export const WINDOW_CONTROL_CHANNEL = 'serpent:shell:window-control' as const;
/** Main → Renderer: trigger invert selection (macOS Edit menu, Serpent-te8p). */
export const INVERT_SELECTION_CHANNEL = 'serpent:shell:invert-selection' as const;
/** Main → Renderer: Edit Copy (⌘C) — file copy when assets selected (Serpent-166q). */
export const COPY_SELECTION_CHANNEL = 'serpent:shell:copy-selection' as const;
/** Renderer → Main: fall back to Chromium text copy when no asset file copy. */
export const NATIVE_EDIT_COPY_CHANNEL = 'serpent:shell:native-edit-copy' as const;
export const WINDOW_MAXIMIZED_CHANNEL =
  'serpent:shell:window-maximized' as const;
/** Main → Renderer: BrowserWindow focus state (macOS traffic lights / shell chrome). */
export const WINDOW_FOCUS_CHANNEL = 'serpent:shell:window-focus' as const;
/** Renderer → Main: enable Main before-input capture for video letter keys. */
export const VIEWER_VIDEO_SHORTCUTS_ACTIVE_CHANNEL =
  'serpent:viewer:video-shortcuts-active' as const;
/** Main → Renderer: video letter shortcut (D/F/X/C) after before-input. */
export const VIEWER_VIDEO_SHORTCUT_CHANNEL =
  'serpent:viewer:video-shortcut' as const;

/** Renderer Desktop Console → Main-owned Automation Execution/Gateway bridge. */
export const AUTOMATION_SCRIPT_START_CHANNEL = 'serpent:automation:script-start' as const;
export const AUTOMATION_SCRIPT_COMMAND_CHANNEL = 'serpent:automation:script-command' as const;
export const AUTOMATION_SCRIPT_COMPLETE_CHANNEL = 'serpent:automation:script-complete' as const;
export const AUTOMATION_SCRIPT_CANCEL_CHANNEL = 'serpent:automation:script-cancel' as const;

export const WORKER_READY_MESSAGE_TYPE = 'worker.ready' as const;
export const WORKER_SHUTDOWN_MESSAGE_TYPE = 'worker.shutdown' as const;
export const WORKER_SHUTDOWN_ACK_MESSAGE_TYPE = 'worker.shutdown.ack' as const;
