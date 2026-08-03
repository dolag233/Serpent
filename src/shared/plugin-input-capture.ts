import { z } from 'zod';

export const pluginInputCaptureScopeSchema = z.enum(['application', 'viewer', 'view']);
export type PluginInputCaptureScope = z.infer<typeof pluginInputCaptureScopeSchema>;

export const pluginInputCaptureOptionsSchema = z.strictObject({
  scope: pluginInputCaptureScopeSchema,
  keyboard: z.boolean(),
  pointer: z.boolean(),
  ownerViewId: z.string().min(1).max(255).optional(),
}).superRefine((value, context) => {
  if (value.scope === 'view' && value.ownerViewId === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['ownerViewId'],
      message: 'View-scoped input capture requires ownerViewId.',
    });
  }
});
export type PluginInputCaptureOptions = z.infer<typeof pluginInputCaptureOptionsSchema>;

const modifierSchema = z.strictObject({
  altKey: z.boolean(),
  ctrlKey: z.boolean(),
  metaKey: z.boolean(),
  shiftKey: z.boolean(),
});

const eventBaseSchema = z.strictObject({
  timestamp: z.number().finite(),
});

export const pluginInputCaptureEventSchema = z.discriminatedUnion('type', [
  eventBaseSchema.extend({
    type: z.literal('keydown'),
    key: z.string().max(128),
    code: z.string().max(128),
    repeat: z.boolean(),
    ...modifierSchema.shape,
    isComposing: z.boolean(),
  }),
  eventBaseSchema.extend({
    type: z.literal('keyup'),
    key: z.string().max(128),
    code: z.string().max(128),
    repeat: z.boolean(),
    ...modifierSchema.shape,
    isComposing: z.boolean(),
  }),
  eventBaseSchema.extend({
    type: z.literal('text'),
    text: z.string().max(16 * 1024),
  }),
  eventBaseSchema.extend({
    type: z.literal('compositionstart'),
    data: z.string().max(16 * 1024),
  }),
  eventBaseSchema.extend({
    type: z.literal('compositionupdate'),
    data: z.string().max(16 * 1024),
  }),
  eventBaseSchema.extend({
    type: z.literal('compositionend'),
    data: z.string().max(16 * 1024),
  }),
  eventBaseSchema.extend({
    type: z.literal('pointerdown'),
    pointerId: z.number().int(),
    x: z.number().finite(),
    y: z.number().finite(),
    buttons: z.number().int().nonnegative(),
    button: z.number().int(),
  }),
  eventBaseSchema.extend({
    type: z.literal('pointerup'),
    pointerId: z.number().int(),
    x: z.number().finite(),
    y: z.number().finite(),
    buttons: z.number().int().nonnegative(),
    button: z.number().int(),
  }),
  eventBaseSchema.extend({
    type: z.literal('pointermove'),
    pointerId: z.number().int(),
    x: z.number().finite(),
    y: z.number().finite(),
    buttons: z.number().int().nonnegative(),
  }),
  eventBaseSchema.extend({
    type: z.literal('pointercancel'),
    pointerId: z.number().int(),
    x: z.number().finite(),
    y: z.number().finite(),
    buttons: z.number().int().nonnegative(),
  }),
  eventBaseSchema.extend({
    type: z.literal('wheel'),
    deltaX: z.number().finite(),
    deltaY: z.number().finite(),
    deltaMode: z.number().int().nonnegative(),
    x: z.number().finite(),
    y: z.number().finite(),
    ...modifierSchema.shape,
  }),
]);
export type PluginInputCaptureEvent = z.infer<typeof pluginInputCaptureEventSchema>;

export type PluginInputCaptureTarget =
  | { scope: 'application' }
  | { scope: 'viewer' }
  | { scope: 'view'; viewId: string };

export type PluginInputCaptureSession = {
  readonly sessionId: string;
  readonly instanceId: string;
  readonly pluginId: string;
  readonly libraryId: string;
  readonly scope: PluginInputCaptureScope;
  readonly ownerViewId?: string;
  readonly keyboard: boolean;
  readonly pointer: boolean;
};

export const pluginInputCaptureEndReasonSchema = z.enum([
  'released',
  'emergency-escape',
  'system-modal',
  'plugin-crashed',
  'plugin-deactivated',
  'view-closed',
  'library-closed',
  'window-blur',
]);
export type PluginInputCaptureEndReason = z.infer<typeof pluginInputCaptureEndReasonSchema>;

export type PluginInputCaptureStartInput = PluginInputCaptureOptions & {
  instanceId: string;
  pluginId: string;
  libraryId: string;
  permissions: readonly string[];
};

export type PluginInputCaptureStartResult =
  | { ok: true; session: PluginInputCaptureSession }
  | {
    ok: false;
    code: 'PERMISSION_DENIED' | 'INVALID_OPTIONS' | 'APPLICATION_CAPTURE_BUSY' | 'CAPTURE_UNAVAILABLE';
    message: string;
  };

type ActiveSession = PluginInputCaptureSession & {
  permissions: readonly string[];
  pendingHighFrequency: Map<'pointermove' | 'wheel', PluginInputCaptureEvent>;
};

type BrokerOptions = {
  onEvent?: (session: PluginInputCaptureSession, event: PluginInputCaptureEvent) => void;
  onEnd?: (session: PluginInputCaptureSession, reason: PluginInputCaptureEndReason) => void;
  onStart?: (session: PluginInputCaptureSession) => void;
  createSessionId?: () => string;
  maxQueuedEvents?: number;
};

function permissionForScope(scope: PluginInputCaptureScope): string {
  if (scope === 'application') return 'input.capture.application';
  if (scope === 'viewer') return 'input.capture.viewer';
  return 'input.capture.view';
}

function isHighFrequencyEvent(
  event: PluginInputCaptureEvent,
): event is Extract<PluginInputCaptureEvent, { type: 'pointermove' | 'wheel' }> {
  return event.type === 'pointermove' || event.type === 'wheel';
}

function acceptsTarget(session: PluginInputCaptureSession, target: PluginInputCaptureTarget): boolean {
  if (session.scope === 'application') return true;
  if (session.scope === 'viewer') return target.scope === 'viewer';
  return target.scope === 'view' && session.ownerViewId === target.viewId;
}

/**
 * Main-owned input capture state machine. It deliberately has no Electron
 * dependency so mutex, permission, lifecycle, emergency release, and
 * backpressure semantics can be tested without creating a window.
 */
export class PluginInputCaptureBroker {
  readonly #sessions = new Map<string, ActiveSession>();
  readonly #options: BrokerOptions;
  readonly #maxQueuedEvents: number;
  #applicationOwner: string | undefined;
  #systemModalActive = false;

  public constructor(options: BrokerOptions = {}) {
    this.#options = options;
    this.#maxQueuedEvents = Math.max(1, Math.floor(options.maxQueuedEvents ?? 64));
  }

  public start(input: PluginInputCaptureStartInput): PluginInputCaptureStartResult {
    const parsed = pluginInputCaptureOptionsSchema.safeParse({
      scope: input.scope,
      keyboard: input.keyboard,
      pointer: input.pointer,
      ...(input.ownerViewId === undefined ? {} : { ownerViewId: input.ownerViewId }),
    });
    if (!parsed.success) {
      return {
        ok: false,
        code: 'INVALID_OPTIONS',
        message: 'The input capture options are invalid.',
      };
    }
    const options = parsed.data;
    const requiredPermission = permissionForScope(options.scope);
    if (!input.permissions.includes(requiredPermission)) {
      return {
        ok: false,
        code: 'PERMISSION_DENIED',
        message: `The plugin does not have permission for ${options.scope} input capture.`,
      };
    }
    if (options.scope === 'application' && this.#applicationOwner !== undefined) {
      return {
        ok: false,
        code: 'APPLICATION_CAPTURE_BUSY',
        message: 'Another plugin already owns application input capture.',
      };
    }

    const session: ActiveSession = {
      sessionId: this.#options.createSessionId?.() ?? globalThis.crypto.randomUUID(),
      instanceId: input.instanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      scope: options.scope,
      ...(options.ownerViewId === undefined ? {} : { ownerViewId: options.ownerViewId }),
      keyboard: options.keyboard,
      pointer: options.pointer,
      permissions: [...input.permissions],
      pendingHighFrequency: new Map(),
    };
    this.#sessions.set(session.sessionId, session);
    if (options.scope === 'application') this.#applicationOwner = session.sessionId;
    const publicSession = this.#publicSession(session);
    this.#options.onStart?.(publicSession);
    return { ok: true, session: publicSession };
  }

  public publish(input: {
    target: PluginInputCaptureTarget;
    event: PluginInputCaptureEvent;
  }): 'delivered' | 'queued' | 'ignored' | 'released' {
    const parsed = pluginInputCaptureEventSchema.safeParse(input.event);
    if (!parsed.success) return 'ignored';
    const session = this.#findMatchingSession(input.target);
    if (session === undefined) return 'ignored';
    const event = parsed.data;
    if (this.#systemModalActive) return 'ignored';
    if (event.type === 'keydown' && event.key === 'Escape' && session.scope === 'application') {
      this.release(session.sessionId, 'emergency-escape');
      return 'released';
    }
    if (event.type.startsWith('pointer') && !session.pointer) return 'ignored';
    if (!event.type.startsWith('pointer') && event.type === 'wheel' && !session.pointer) return 'ignored';
    if (
      (event.type === 'keydown'
        || event.type === 'keyup'
        || event.type === 'text'
        || event.type.startsWith('composition'))
      && !session.keyboard
    ) return 'ignored';

    if (isHighFrequencyEvent(event)) {
      if (session.pendingHighFrequency.size >= this.#maxQueuedEvents
        && !session.pendingHighFrequency.has(event.type)) {
        const oldest = session.pendingHighFrequency.keys().next().value as 'pointermove' | 'wheel' | undefined;
        if (oldest !== undefined) session.pendingHighFrequency.delete(oldest);
      }
      session.pendingHighFrequency.set(event.type, event);
      return 'queued';
    }
    this.#options.onEvent?.(session, event);
    return 'delivered';
  }

  public flush(): void {
    for (const session of this.#sessions.values()) {
      for (const event of session.pendingHighFrequency.values()) {
        this.#options.onEvent?.(session, event);
      }
      session.pendingHighFrequency.clear();
    }
  }

  public release(sessionId: string, reason: PluginInputCaptureEndReason = 'released'): boolean {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return false;
    this.#sessions.delete(sessionId);
    if (this.#applicationOwner === sessionId) this.#applicationOwner = undefined;
    this.#options.onEnd?.(session, reason);
    return true;
  }

  public releaseForInstance(instanceId: string, reason: PluginInputCaptureEndReason = 'plugin-deactivated'): void {
    for (const session of [...this.#sessions.values()]) {
      if (session.instanceId === instanceId) this.release(session.sessionId, reason);
    }
  }

  public releaseForView(viewId: string): void {
    for (const session of [...this.#sessions.values()]) {
      if (session.scope === 'view' && session.ownerViewId === viewId) {
        this.release(session.sessionId, 'view-closed');
      }
    }
  }

  public releaseForLibrary(libraryId: string): void {
    for (const session of [...this.#sessions.values()]) {
      if (session.libraryId === libraryId) this.release(session.sessionId, 'library-closed');
    }
  }

  public releaseForWindowBlur(): void {
    for (const session of [...this.#sessions.values()]) this.release(session.sessionId, 'window-blur');
  }

  public setSystemModalActive(active: boolean): void {
    // Pause delivery while a Host modal is open; sessions stay alive and resume
    // when the modal closes (0024: dialogs outrank plugins).
    this.#systemModalActive = active;
  }

  public isSystemModalActive(): boolean {
    return this.#systemModalActive;
  }

  public activeSessions(): PluginInputCaptureSession[] {
    return [...this.#sessions.values()].map((session) => this.#publicSession(session));
  }

  public owner(): PluginInputCaptureSession | undefined {
    const session = this.#applicationOwner === undefined
      ? undefined
      : this.#sessions.get(this.#applicationOwner);
    return session === undefined ? undefined : this.#publicSession(session);
  }

  public getSession(sessionId: string): PluginInputCaptureSession | undefined {
    const session = this.#sessions.get(sessionId);
    return session === undefined ? undefined : this.#publicSession(session);
  }

  #findMatchingSession(target: PluginInputCaptureTarget): ActiveSession | undefined {
    const candidates = [...this.#sessions.values()].filter((session) => acceptsTarget(session, target));
    return candidates.find((session) => session.scope === 'view')
      ?? candidates.find((session) => session.scope === 'viewer')
      ?? candidates.find((session) => session.scope === 'application');
  }

  #publicSession(session: ActiveSession): PluginInputCaptureSession {
    const { permissions, pendingHighFrequency, ...publicSession } = session;
    void permissions;
    void pendingHighFrequency;
    return publicSession;
  }
}
