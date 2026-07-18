export const LIBRARY_REQUEST_CHANNEL = 'serpent:library:request' as const;
export const LIBRARY_LIFECYCLE_CHANNEL = 'serpent:library:lifecycle' as const;
export const ASSET_CHANGE_CHANNEL = 'serpent:asset:changed' as const;
export const THUMBNAIL_CHANNEL = 'serpent:thumbnail' as const;
export const PROGRESS_CHANNEL = 'serpent:progress' as const;
export const AI_PROGRESS_CHANNEL = 'serpent:ai:progress' as const;
export const AI_COMPLETED_CHANNEL = 'serpent:ai:completed' as const;
export const AI_CLEARED_CHANNEL = 'serpent:ai:cleared' as const;

export const ACTIVE_CONTEXT_CHANNEL = 'serpent:active-context' as const;
export const EXTENSION_PAIRING_CHANNEL = 'serpent:extension-pairing' as const;
export const OPEN_EXTERNAL_URL_CHANNEL = 'serpent:shell:open-external-url' as const;
export const SHELL_SWIPE_CHANNEL = 'serpent:shell:swipe' as const;

export const WORKER_READY_MESSAGE_TYPE = 'worker.ready' as const;
export const WORKER_SHUTDOWN_MESSAGE_TYPE = 'worker.shutdown' as const;
export const WORKER_SHUTDOWN_ACK_MESSAGE_TYPE = 'worker.shutdown.ack' as const;
