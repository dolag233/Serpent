import { describe, expect, it } from 'vitest';

import {
  isDialogEscapeLayerActive,
  type DialogEscapeSnapshot,
} from '../../src/renderer/dialog-escape-stack';
import {
  resolvePluginInputCaptureSystemModalActive,
} from '../../src/renderer/plugin-input-capture-modal-seam';
import {
  captureEventKind,
  resolvePluginInputCaptureFanInTargets,
  serializeCompositionEvent,
  serializeKeyboardEvent,
  serializePointerEvent,
  serializePointerMoveEvent,
  serializeTextFromBeforeInput,
  serializeWheelEvent,
  sessionAcceptsCaptureEvent,
  shouldRendererConsumeDomEvent,
  shouldRendererForwardKeyboard,
} from '../../src/shared/plugin-input-capture-renderer';

const emptySnapshot: DialogEscapeSnapshot = {
  assetRenameOpen: false,
  imageSequenceImportOpen: false,
  imageSequenceDialogOpen: false,
  permanentDeleteOpen: false,
  diskDeleteOpen: false,
  deleteLinkedOpen: false,
  batchRelinkOpen: false,
  restoreOpen: false,
  moveOpen: false,
  undoMoveOpen: false,
  collectionEditorOpen: false,
  exportDialogOpen: false,
  importLibraryChooserOpen: false,
  appSettingsOpen: false,
  librarySettingsOpen: false,
  appLogOpen: false,
  aboutOpen: false,
  openSourceLicensesOpen: false,
  scriptSandboxPreviewOpen: false,
  mediaJobsOpen: false,
  linkedRulesEditorOpen: false,
  convertLinkedOpen: false,
  dialogOpen: false,
  pluginTrustPromptOpen: false,
  fatalAlertOpen: false,
  aiConnectionFailureOpen: false,
  conflictsImportId: null,
};

describe('plugin input capture renderer serialization', () => {
  it('serializes keyboard, pointer, wheel, composition, and beforeinput text', () => {
    expect(serializeKeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      repeat: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      isComposing: false,
    })).toEqual({
      type: 'keydown',
      timestamp: expect.any(Number),
      key: 'a',
      code: 'KeyA',
      repeat: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      isComposing: false,
    });

    expect(serializeCompositionEvent('compositionupdate', { data: '中' })).toEqual({
      type: 'compositionupdate',
      timestamp: expect.any(Number),
      data: '中',
    });

    expect(serializePointerMoveEvent('pointermove', {
      pointerId: 1,
      clientX: 12,
      clientY: 24,
      buttons: 0,
    })).toEqual({
      type: 'pointermove',
      timestamp: expect.any(Number),
      pointerId: 1,
      x: 12,
      y: 24,
      buttons: 0,
    });

    expect(serializePointerEvent('pointerdown', {
      pointerId: 2,
      clientX: 1,
      clientY: 2,
      buttons: 1,
      button: 0,
    })).toMatchObject({ type: 'pointerdown', button: 0 });

    expect(serializeWheelEvent({
      deltaX: 0,
      deltaY: 3,
      deltaMode: 0,
      clientX: 1,
      clientY: 2,
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    })).toMatchObject({ type: 'wheel', deltaY: 3, ctrlKey: true });

    expect(serializeTextFromBeforeInput({
      inputType: 'insertText',
      data: 'x',
    })).toEqual({ type: 'text', timestamp: expect.any(Number), text: 'x' });
    expect(serializeTextFromBeforeInput({ inputType: 'deleteContentBackward', data: null })).toBeNull();
  });

  it('resolves fan-in targets and keyboard forwarding policy', () => {
    const sessions = [
      {
        sessionId: '00000000-0000-4000-8000-000000000001',
        scope: 'application' as const,
        keyboard: true,
        pointer: true,
      },
      {
        sessionId: '00000000-0000-4000-8000-000000000002',
        scope: 'viewer' as const,
        keyboard: true,
        pointer: false,
      },
    ];

    expect(resolvePluginInputCaptureFanInTargets(sessions, false)).toEqual([{ scope: 'application' }]);
    expect(resolvePluginInputCaptureFanInTargets(sessions, true)).toEqual([
      { scope: 'application' },
      { scope: 'viewer' },
    ]);

    const application = sessions[0]!;
    const viewer = sessions[1]!;
    expect(shouldRendererForwardKeyboard(application, 'keydown')).toBe(false);
    expect(shouldRendererForwardKeyboard(viewer, 'keydown')).toBe(true);

    const wheel = serializeWheelEvent({
      deltaX: 0,
      deltaY: 1,
      deltaMode: 0,
      clientX: 0,
      clientY: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(captureEventKind(wheel)).toBe('wheel');
    expect(sessionAcceptsCaptureEvent(application, wheel)).toBe(true);
    expect(sessionAcceptsCaptureEvent(viewer, wheel)).toBe(false);

    const composition = serializeCompositionEvent('compositionstart', { data: '' });
    expect(shouldRendererConsumeDomEvent(sessions, { scope: 'application' }, composition)).toBe(true);
  });
});

describe('plugin input capture modal seam', () => {
  it('treats escape-stack layers and DOM modals as system modal active', () => {
    expect(resolvePluginInputCaptureSystemModalActive(emptySnapshot)).toBe(false);
    expect(resolvePluginInputCaptureSystemModalActive({
      ...emptySnapshot,
      fatalAlertOpen: true,
    })).toBe(true);
    expect(isDialogEscapeLayerActive({
      ...emptySnapshot,
      conflictsImportId: 'import-1',
    })).toBe(true);
    expect(resolvePluginInputCaptureSystemModalActive(emptySnapshot, { domModalOpen: true })).toBe(true);
  });
});
