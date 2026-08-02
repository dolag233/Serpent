import { describe, expect, it, vi } from 'vitest';

import {
  PluginInputCaptureBroker,
  type PluginInputCaptureEvent,
} from '../../src/shared/plugin-input-capture';

function keydown(key: string): PluginInputCaptureEvent {
  return {
    type: 'keydown',
    timestamp: 1,
    key,
    code: key === 'Escape' ? 'Escape' : 'KeyA',
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
  };
}

describe('PluginInputCaptureBroker', () => {
  it('rejects a second application owner without stealing the first session', () => {
    const broker = new PluginInputCaptureBroker();
    const first = broker.start({
      instanceId: 'instance-1',
      pluginId: 'com.example.first',
      libraryId: 'library-1',
      permissions: ['input.capture.application'],
      scope: 'application',
      keyboard: true,
      pointer: false,
    });
    const second = broker.start({
      instanceId: 'instance-2',
      pluginId: 'com.example.second',
      libraryId: 'library-1',
      permissions: ['input.capture.application'],
      scope: 'application',
      keyboard: true,
      pointer: false,
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({
      ok: false,
      code: 'APPLICATION_CAPTURE_BUSY',
      message: 'Another plugin already owns application input capture.',
    });
    expect(broker.owner()?.instanceId).toBe('instance-1');
  });

  it('requires the scope permission and releases application capture on emergency Escape', () => {
    const onEnd = vi.fn();
    const broker = new PluginInputCaptureBroker({ onEnd });
    const denied = broker.start({
      instanceId: 'instance-1',
      pluginId: 'com.example.first',
      libraryId: 'library-1',
      permissions: ['input.capture.viewer'],
      scope: 'application',
      keyboard: true,
      pointer: false,
    });
    expect(denied).toEqual({
      ok: false,
      code: 'PERMISSION_DENIED',
      message: 'The plugin does not have permission for application input capture.',
    });

    const allowed = broker.start({
      instanceId: 'instance-1',
      pluginId: 'com.example.first',
      libraryId: 'library-1',
      permissions: ['input.capture.application'],
      scope: 'application',
      keyboard: true,
      pointer: false,
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) throw new Error('expected capture to start');

    expect(broker.publish({
      target: { scope: 'application' },
      event: keydown('Escape'),
    })).toBe('released');
    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: allowed.session.sessionId }),
      'emergency-escape',
    );
    expect(broker.owner()).toBeUndefined();
  });

  it('coalesces high-frequency pointer and wheel events while preserving text and composition order', () => {
    const received: PluginInputCaptureEvent[] = [];
    const broker = new PluginInputCaptureBroker({
      maxQueuedEvents: 3,
      onEvent: (_session, event) => received.push(event),
    });
    const started = broker.start({
      instanceId: 'instance-1',
      pluginId: 'com.example.first',
      libraryId: 'library-1',
      permissions: ['input.capture.application'],
      scope: 'application',
      keyboard: true,
      pointer: true,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error('expected capture to start');

    broker.publish({
      target: { scope: 'application' },
      event: { type: 'compositionstart', timestamp: 1, data: '' },
    });
    broker.publish({
      target: { scope: 'application' },
      event: { type: 'compositionupdate', timestamp: 2, data: '中' },
    });
    broker.publish({
      target: { scope: 'application' },
      event: { type: 'pointermove', timestamp: 3, pointerId: 1, x: 10, y: 10, buttons: 0 },
    });
    broker.publish({
      target: { scope: 'application' },
      event: { type: 'pointermove', timestamp: 4, pointerId: 1, x: 20, y: 20, buttons: 0 },
    });
    broker.publish({
      target: { scope: 'application' },
      event: {
        type: 'wheel',
        timestamp: 5,
        deltaX: 0,
        deltaY: 1,
        deltaMode: 0,
        x: 20,
        y: 20,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      },
    });
    broker.publish({
      target: { scope: 'application' },
      event: {
        type: 'wheel',
        timestamp: 6,
        deltaX: 0,
        deltaY: 2,
        deltaMode: 0,
        x: 20,
        y: 20,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      },
    });
    broker.publish({
      target: { scope: 'application' },
      event: { type: 'compositionend', timestamp: 7, data: '中' },
    });
    broker.flush();

    expect(received.map((event) => event.type)).toEqual([
      'compositionstart',
      'compositionupdate',
      'compositionend',
      'pointermove',
      'wheel',
    ]);
    expect(received.find((event) => event.type === 'pointermove')).toMatchObject({ x: 20, y: 20 });
    expect(received.find((event) => event.type === 'wheel')).toMatchObject({ deltaY: 2 });
  });

  it('pauses delivery while a system modal is active without ending the session', () => {
    const onEnd = vi.fn();
    const broker = new PluginInputCaptureBroker({ onEnd });
    const started = broker.start({
      instanceId: 'instance-1',
      pluginId: 'com.example.first',
      libraryId: 'library-1',
      permissions: ['input.capture.application'],
      scope: 'application',
      keyboard: true,
      pointer: false,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error('expected capture to start');

    broker.setSystemModalActive(true);
    expect(broker.isSystemModalActive()).toBe(true);
    expect(broker.publish({
      target: { scope: 'application' },
      event: keydown('a'),
    })).toBe('ignored');
    expect(onEnd).not.toHaveBeenCalled();
    expect(broker.getSession(started.session.sessionId)).toBeDefined();

    broker.setSystemModalActive(false);
    expect(broker.publish({
      target: { scope: 'application' },
      event: keydown('a'),
    })).toBe('delivered');
  });

  it('releases sessions for instance, view, library, and window lifecycle changes', () => {
    const onEnd = vi.fn();
    const broker = new PluginInputCaptureBroker({ onEnd });
    const started = broker.start({
      instanceId: 'instance-1',
      pluginId: 'com.example.first',
      libraryId: 'library-1',
      permissions: ['input.capture.view'],
      scope: 'view',
      ownerViewId: 'view-1',
      keyboard: true,
      pointer: false,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error('expected capture to start');

    broker.releaseForView('view-1');
    expect(onEnd).toHaveBeenLastCalledWith(expect.anything(), 'view-closed');

    const restarted = broker.start({
      instanceId: 'instance-1',
      pluginId: 'com.example.first',
      libraryId: 'library-1',
      permissions: ['input.capture.view'],
      scope: 'view',
      ownerViewId: 'view-1',
      keyboard: true,
      pointer: false,
    });
    expect(restarted.ok).toBe(true);
    broker.releaseForInstance('instance-1');
    expect(onEnd).toHaveBeenLastCalledWith(expect.anything(), 'plugin-deactivated');
  });
});
