import { z } from 'zod';

import {
  pluginInputCaptureEventSchema,
  pluginInputCaptureScopeSchema,
  type PluginInputCaptureEvent,
  type PluginInputCaptureTarget,
} from './plugin-input-capture';

/** Renderer-visible snapshot of an active capture session (Main → Renderer). */
export const pluginInputCaptureRendererSessionSchema = z.strictObject({
  sessionId: z.string().uuid(),
  scope: pluginInputCaptureScopeSchema,
  ownerViewId: z.string().min(1).max(255).optional(),
  keyboard: z.boolean(),
  pointer: z.boolean(),
});
export type PluginInputCaptureRendererSession = z.infer<
  typeof pluginInputCaptureRendererSessionSchema
>;

export const pluginInputCaptureSessionsPayloadSchema = z.strictObject({
  sessions: z.array(pluginInputCaptureRendererSessionSchema),
});
export type PluginInputCaptureSessionsPayload = z.infer<
  typeof pluginInputCaptureSessionsPayloadSchema
>;

export const pluginInputCapturePublishPayloadSchema = z.strictObject({
  target: z.discriminatedUnion('scope', [
    z.strictObject({ scope: z.literal('application') }),
    z.strictObject({ scope: z.literal('viewer') }),
    z.strictObject({ scope: z.literal('view'), viewId: z.string().min(1).max(255) }),
  ]),
  event: pluginInputCaptureEventSchema,
});
export type PluginInputCapturePublishPayload = z.infer<
  typeof pluginInputCapturePublishPayloadSchema
>;

export const pluginInputCaptureSystemModalPayloadSchema = z.strictObject({
  active: z.boolean(),
});
export type PluginInputCaptureSystemModalPayload = z.infer<
  typeof pluginInputCaptureSystemModalPayloadSchema
>;

export function parsePluginInputCaptureSessionsPayload(
  input: unknown,
): PluginInputCaptureSessionsPayload | null {
  const parsed = pluginInputCaptureSessionsPayloadSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parsePluginInputCapturePublishPayload(
  input: unknown,
): PluginInputCapturePublishPayload | null {
  const parsed = pluginInputCapturePublishPayloadSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parsePluginInputCaptureSystemModalPayload(
  input: unknown,
): PluginInputCaptureSystemModalPayload | null {
  const parsed = pluginInputCaptureSystemModalPayloadSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function sessionMatchesTarget(
  session: PluginInputCaptureRendererSession,
  target: PluginInputCaptureTarget,
): boolean {
  if (session.scope === 'application') return target.scope === 'application';
  if (session.scope === 'viewer') return target.scope === 'viewer';
  return target.scope === 'view' && session.ownerViewId === target.viewId;
}

export function findSessionForTarget(
  sessions: readonly PluginInputCaptureRendererSession[],
  target: PluginInputCaptureTarget,
): PluginInputCaptureRendererSession | undefined {
  return sessions.find((session) => sessionMatchesTarget(session, target));
}

/** Targets that may receive fan-in for the current shell state. */
export function resolvePluginInputCaptureFanInTargets(
  sessions: readonly PluginInputCaptureRendererSession[],
  previewOpen: boolean,
): PluginInputCaptureTarget[] {
  const targets: PluginInputCaptureTarget[] = [];
  if (sessions.some((session) => session.scope === 'application')) {
    targets.push({ scope: 'application' });
  }
  if (previewOpen && sessions.some((session) => session.scope === 'viewer')) {
    targets.push({ scope: 'viewer' });
  }
  for (const session of sessions) {
    if (session.scope === 'view' && session.ownerViewId !== undefined) {
      targets.push({ scope: 'view', viewId: session.ownerViewId });
    }
  }
  return targets;
}

export function captureEventKind(
  event: PluginInputCaptureEvent,
): 'keyboard' | 'pointer' | 'wheel' | 'text' | 'composition' {
  if (event.type === 'wheel') return 'wheel';
  if (event.type.startsWith('pointer')) return 'pointer';
  if (event.type.startsWith('composition')) return 'composition';
  if (event.type === 'text') return 'text';
  return 'keyboard';
}

export function sessionAcceptsCaptureEvent(
  session: PluginInputCaptureRendererSession,
  event: PluginInputCaptureEvent,
): boolean {
  const kind = captureEventKind(event);
  if (kind === 'pointer' || kind === 'wheel') return session.pointer;
  return session.keyboard;
}

/**
 * Application keyboard is delivered via Main `before-input-event`; Renderer
 * still forwards composition/text for IME on application scope.
 */
export function shouldRendererForwardKeyboard(
  session: PluginInputCaptureRendererSession,
  eventType: 'keydown' | 'keyup',
): boolean {
  if (!session.keyboard) return false;
  if (session.scope === 'application') return false;
  return eventType === 'keydown' || eventType === 'keyup';
}

export function shouldRendererConsumeDomEvent(
  sessions: readonly PluginInputCaptureRendererSession[],
  target: PluginInputCaptureTarget,
  event: PluginInputCaptureEvent,
): boolean {
  const session = findSessionForTarget(sessions, target);
  if (session === undefined) return false;
  if (!sessionAcceptsCaptureEvent(session, event)) return false;
  if (event.type === 'keydown' || event.type === 'keyup') {
    return shouldRendererForwardKeyboard(session, event.type);
  }
  return true;
}

export function serializeKeyboardEvent(
  type: 'keydown' | 'keyup',
  event: Pick<
    KeyboardEvent,
    'key' | 'code' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing'
  >,
  timestamp = Date.now(),
): PluginInputCaptureEvent {
  return {
    type,
    timestamp,
    key: event.key,
    code: event.code,
    repeat: event.repeat,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    isComposing: event.isComposing,
  };
}

export function serializeCompositionEvent(
  type: 'compositionstart' | 'compositionupdate' | 'compositionend',
  event: Pick<CompositionEvent, 'data'>,
  timestamp = Date.now(),
): PluginInputCaptureEvent {
  return { type, timestamp, data: event.data };
}

export function serializePointerEvent(
  type: 'pointerdown' | 'pointerup',
  event: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'buttons' | 'button'>,
  timestamp = Date.now(),
): PluginInputCaptureEvent {
  return {
    type,
    timestamp,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    buttons: event.buttons,
    button: event.button,
  };
}

export function serializePointerMoveEvent(
  type: 'pointermove' | 'pointercancel',
  event: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'buttons'>,
  timestamp = Date.now(),
): PluginInputCaptureEvent {
  return {
    type,
    timestamp,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    buttons: event.buttons,
  };
}

export function serializeWheelEvent(
  event: Pick<
    WheelEvent,
    'deltaX' | 'deltaY' | 'deltaMode' | 'clientX' | 'clientY' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
  >,
  timestamp = Date.now(),
): PluginInputCaptureEvent {
  return {
    type: 'wheel',
    timestamp,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    x: event.clientX,
    y: event.clientY,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  };
}

export function serializeTextFromBeforeInput(
  event: Pick<InputEvent, 'inputType' | 'data'>,
  timestamp = Date.now(),
): PluginInputCaptureEvent | null {
  if (
    event.inputType !== 'insertText'
    && event.inputType !== 'insertFromPaste'
    && event.inputType !== 'insertCompositionText'
  ) {
    return null;
  }
  const text = event.data ?? '';
  if (text.length === 0) return null;
  return { type: 'text', timestamp, text };
}
