import { useEffect, useRef } from 'react';

import type { PluginInputCaptureRendererSession } from '../shared/plugin-input-capture-renderer';
import {
  findSessionForTarget,
  resolvePluginInputCaptureFanInTargets,
  serializeCompositionEvent,
  serializeKeyboardEvent,
  serializePointerEvent,
  serializePointerMoveEvent,
  serializeTextFromBeforeInput,
  serializeWheelEvent,
  shouldRendererConsumeDomEvent,
  shouldRendererForwardKeyboard,
} from '../shared/plugin-input-capture-renderer';
import type { SerpentShellApi } from '../shared/external-url';
import { isTypingKeyboardTarget } from './video-player-controls';

function isEditableCaptureTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Forward DOM input into Main-owned capture broker when sessions are active.
 * Application keyboard stays on Main `before-input-event`; Renderer handles
 * composition/text/pointer/wheel and viewer/view keyboard.
 */
export function usePluginInputCaptureFanIn(input: {
  readonly shell: SerpentShellApi | undefined;
  readonly enabled: boolean;
  readonly previewOpen: boolean;
}): void {
  const sessionsRef = useRef<readonly PluginInputCaptureRendererSession[]>([]);
  const previewOpenRef = useRef(input.previewOpen);

  useEffect(() => {
    previewOpenRef.current = input.previewOpen;
  }, [input.previewOpen]);

  useEffect(() => {
    const shell = input.shell;
    if (!input.enabled || shell?.onInputCaptureSessions === undefined
      || shell.publishInputCaptureEvent === undefined) {
      sessionsRef.current = [];
      return;
    }

    const unsubscribe = shell.onInputCaptureSessions((sessions) => {
      sessionsRef.current = sessions;
    });

    return unsubscribe;
  }, [input.enabled, input.shell]);

  useEffect(() => {
    const shell = input.shell;
    if (!input.enabled || shell?.publishInputCaptureEvent === undefined) return;

    const publishDomEvent = (
      target: ReturnType<typeof resolvePluginInputCaptureFanInTargets>[number],
      event: Parameters<typeof shouldRendererConsumeDomEvent>[2],
    ): void => {
      const sessions = sessionsRef.current;
      if (!shouldRendererConsumeDomEvent(sessions, target, event)) return;
      shell.publishInputCaptureEvent({ target, event });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const sessions = sessionsRef.current;
      const targets = resolvePluginInputCaptureFanInTargets(sessions, previewOpenRef.current);
      const serialized = serializeKeyboardEvent('keydown', event);
      let consumed = false;
      for (const target of targets) {
        const session = findSessionForTarget(sessions, target);
        if (session === undefined || !shouldRendererForwardKeyboard(session, 'keydown')) continue;
        if (isTypingKeyboardTarget(event.target)) continue;
        publishDomEvent(target, serialized);
        consumed = true;
      }
      if (consumed) event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const sessions = sessionsRef.current;
      const targets = resolvePluginInputCaptureFanInTargets(sessions, previewOpenRef.current);
      let consumed = false;
      for (const target of targets) {
        const session = findSessionForTarget(sessions, target);
        if (session === undefined || !shouldRendererForwardKeyboard(session, 'keyup')) continue;
        if (isTypingKeyboardTarget(event.target)) continue;
        publishDomEvent(target, serializeKeyboardEvent('keyup', event));
        consumed = true;
      }
      if (consumed) event.preventDefault();
    };

    const onComposition = (event: CompositionEvent) => {
      if (event.type !== 'compositionstart'
        && event.type !== 'compositionupdate'
        && event.type !== 'compositionend') return;
      const serialized = serializeCompositionEvent(event.type, event);
      const targets = resolvePluginInputCaptureFanInTargets(
        sessionsRef.current,
        previewOpenRef.current,
      );
      let consumed = false;
      for (const target of targets) {
        if (!shouldRendererConsumeDomEvent(sessionsRef.current, target, serialized)) continue;
        if (isEditableCaptureTarget(event.target)) continue;
        publishDomEvent(target, serialized);
        consumed = true;
      }
      if (consumed) event.preventDefault();
    };

    const onPointer = (event: PointerEvent) => {
      const serialized = event.type === 'pointerdown' || event.type === 'pointerup'
        ? serializePointerEvent(event.type, event)
        : event.type === 'pointermove' || event.type === 'pointercancel'
          ? serializePointerMoveEvent(event.type, event)
          : null;
      if (serialized === null) return;
      const targets = resolvePluginInputCaptureFanInTargets(
        sessionsRef.current,
        previewOpenRef.current,
      );
      let consumed = false;
      for (const target of targets) {
        if (!shouldRendererConsumeDomEvent(sessionsRef.current, target, serialized)) continue;
        publishDomEvent(target, serialized);
        consumed = true;
      }
      if (consumed) event.preventDefault();
    };

    const onWheel = (event: WheelEvent) => {
      const serialized = serializeWheelEvent(event);
      const targets = resolvePluginInputCaptureFanInTargets(
        sessionsRef.current,
        previewOpenRef.current,
      );
      let consumed = false;
      for (const target of targets) {
        if (!shouldRendererConsumeDomEvent(sessionsRef.current, target, serialized)) continue;
        publishDomEvent(target, serialized);
        consumed = true;
      }
      if (consumed) event.preventDefault();
    };

    const onBeforeInput = (event: InputEvent) => {
      const serialized = serializeTextFromBeforeInput(event);
      if (serialized === null) return;
      const targets = resolvePluginInputCaptureFanInTargets(
        sessionsRef.current,
        previewOpenRef.current,
      );
      let consumed = false;
      for (const target of targets) {
        if (!shouldRendererConsumeDomEvent(sessionsRef.current, target, serialized)) continue;
        if (isEditableCaptureTarget(event.target)) continue;
        publishDomEvent(target, serialized);
        consumed = true;
      }
      if (consumed) event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('compositionstart', onComposition, true);
    window.addEventListener('compositionupdate', onComposition, true);
    window.addEventListener('compositionend', onComposition, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('pointerup', onPointer, true);
    window.addEventListener('pointermove', onPointer, true);
    window.addEventListener('pointercancel', onPointer, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('beforeinput', onBeforeInput, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('compositionstart', onComposition, true);
      window.removeEventListener('compositionupdate', onComposition, true);
      window.removeEventListener('compositionend', onComposition, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('pointerup', onPointer, true);
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('pointercancel', onPointer, true);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('beforeinput', onBeforeInput, true);
    };
  }, [input.enabled, input.shell]);
}
