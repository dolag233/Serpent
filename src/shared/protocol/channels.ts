export const LIBRARY_REQUEST_CHANNEL = 'serpent:library:request' as const;
export const LIBRARY_LIFECYCLE_CHANNEL = 'serpent:library:lifecycle' as const;
export const ASSET_CHANGE_CHANNEL = 'serpent:asset:changed' as const;
export const LIBRARY_CHANGED_CHANNEL = 'serpent:library:changed' as const;
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
/** Main → Renderer: script/MCP/plugin user-visible toast or blocking dialog. */
export const SHELL_NOTIFY_CHANNEL = 'serpent:shell:notify' as const;
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
/** Main → Renderer: apply a selection requested by an attached local Agent. */
export const DESKTOP_AUTOMATION_SELECTION_CHANNEL =
  'serpent:desktop-automation:selection' as const;
/** Main ↔ Renderer: typed browse commands and responses for Attached MCP. */
export const DESKTOP_AUTOMATION_BROWSE_CHANNEL =
  'serpent:desktop-automation:browse' as const;
export const DESKTOP_AUTOMATION_BROWSE_RESULT_CHANNEL =
  'serpent:desktop-automation:browse-result' as const;
/** Renderer → Main: enable Main before-input capture for video letter keys. */
export const VIEWER_VIDEO_SHORTCUTS_ACTIVE_CHANNEL =
  'serpent:viewer:video-shortcuts-active' as const;
/** Main → Renderer: video letter shortcut (D/F/X/C) after before-input. */
export const VIEWER_VIDEO_SHORTCUT_CHANNEL =
  'serpent:viewer:video-shortcut' as const;

/** Renderer Desktop Console → Main-owned Automation Execution/Gateway bridge. */
export const AUTOMATION_SCRIPT_OPEN_CHANNEL = 'serpent:automation:script-open' as const;
export const AUTOMATION_SCRIPT_SAVE_CHANNEL = 'serpent:automation:script-save' as const;
export const AUTOMATION_SCRIPT_START_CHANNEL = 'serpent:automation:script-start' as const;
/** Renderer Desktop Console → Main: run an already Main-authorized execution. */
export const AUTOMATION_SCRIPT_EXECUTE_CHANNEL = 'serpent:automation:script-execute' as const;
export const AUTOMATION_SCRIPT_COMMAND_CHANNEL = 'serpent:automation:script-command' as const;
export const AUTOMATION_SCRIPT_COMPLETE_CHANNEL = 'serpent:automation:script-complete' as const;
export const AUTOMATION_SCRIPT_CANCEL_CHANNEL = 'serpent:automation:script-cancel' as const;
export const AUTOMATION_SCRIPT_HISTORY_CHANNEL = 'serpent:automation:script-history' as const;
export const AUTOMATION_SCRIPT_UNDO_CHANNEL = 'serpent:automation:script-undo' as const;
export const AUTOMATION_SCRIPT_RECENT_LIST_CHANNEL = 'serpent:automation:script-recent-list' as const;
export const AUTOMATION_SCRIPT_RECENT_OPEN_CHANNEL = 'serpent:automation:script-recent-open' as const;
/** Renderer plugin manager → Main. File paths remain Main-owned. */
export const PLUGIN_MANAGER_CHANNEL = 'serpent:plugin-manager:request' as const;
/** Main → Renderer: plugin contributions changed after install/enable/refresh. */
export const PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL =
  'serpent:plugin:contributions-changed' as const;
/** Main → Renderer: active plugin input capture sessions for fan-in gating. */
export const PLUGIN_INPUT_CAPTURE_SESSIONS_CHANNEL =
  'serpent:plugin:input-capture-sessions' as const;
/** Renderer → Main: DOM input capture fan-in event. */
export const PLUGIN_INPUT_CAPTURE_EVENT_CHANNEL =
  'serpent:plugin:input-capture-event' as const;
/** Renderer → Main: system modal pause seam (dialogs outrank plugins). */
export const PLUGIN_INPUT_CAPTURE_SYSTEM_MODAL_CHANNEL =
  'serpent:plugin:input-capture-system-modal' as const;

/**
 * Offscreen model-thumbnail renderer channels (slice E, Serpent-hnmg).
 * Main → offscreen window: a render job (payload = model-thumbnail.render-request).
 * Offscreen window → Main: the rendered frame (payload = model-thumbnail.render-response).
 */
export const OFFSCREEN_THUMBNAIL_RENDER_CHANNEL =
  'serpent:offscreen-thumbnail:render' as const;
export const OFFSCREEN_THUMBNAIL_FRAME_CHANNEL =
  'serpent:offscreen-thumbnail:frame' as const;

export const WORKER_READY_MESSAGE_TYPE = 'worker.ready' as const;
export const WORKER_SHUTDOWN_MESSAGE_TYPE = 'worker.shutdown' as const;
export const WORKER_SHUTDOWN_ACK_MESSAGE_TYPE = 'worker.shutdown.ack' as const;
