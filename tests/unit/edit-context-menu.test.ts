import { describe, expect, it } from 'vitest';

import {
  buildEditContextMenuTemplate,
  isEditableTextTarget,
  parseShowEditContextMenuRequest,
  parseShowEditContextMenuResult,
} from '../../src/shared/edit-context-menu';

describe('parseShowEditContextMenuRequest', () => {
  it('accepts finite coordinates', () => {
    expect(parseShowEditContextMenuRequest({ x: 12.5, y: 40 })).toEqual({
      x: 12.5,
      y: 40,
    });
  });

  it('rejects missing, non-finite, or extra-only payloads', () => {
    expect(parseShowEditContextMenuRequest(null)).toBeNull();
    expect(parseShowEditContextMenuRequest({ x: Number.NaN, y: 1 })).toBeNull();
    expect(parseShowEditContextMenuRequest({ x: 1, y: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseShowEditContextMenuRequest({ x: '1', y: 2 })).toBeNull();
  });
});

describe('parseShowEditContextMenuResult', () => {
  it('accepts structured results and falls back safely', () => {
    expect(parseShowEditContextMenuResult({ ok: true })).toEqual({ ok: true });
    expect(
      parseShowEditContextMenuResult({ ok: false, code: 'unauthorized_sender' }),
    ).toEqual({ ok: false, code: 'unauthorized_sender' });
    expect(parseShowEditContextMenuResult({ ok: false, code: 'not-a-code' })).toEqual({
      ok: false,
      code: 'malformed_request',
    });
  });
});

describe('buildEditContextMenuTemplate', () => {
  it('lists Undo/Cut/Copy/Paste/Delete/Select All via roles', () => {
    const roles = buildEditContextMenuTemplate().flatMap((item) =>
      'role' in item ? [item.role] : [],
    );
    expect(roles).toEqual(['undo', 'cut', 'copy', 'paste', 'delete', 'selectAll']);
  });
});

describe('isEditableTextTarget', () => {
  it('accepts text-like inputs and textareas', () => {
    expect(
      isEditableTextTarget({ tagName: 'INPUT', type: 'text', disabled: false }),
    ).toBe(true);
    expect(
      isEditableTextTarget({ tagName: 'INPUT', type: 'search', disabled: false }),
    ).toBe(true);
    expect(
      isEditableTextTarget({ tagName: 'INPUT', type: 'url', disabled: false }),
    ).toBe(true);
    expect(
      isEditableTextTarget({ tagName: 'TEXTAREA', disabled: false }),
    ).toBe(true);
  });

  it('rejects non-text inputs, disabled fields, and plain elements', () => {
    expect(
      isEditableTextTarget({ tagName: 'INPUT', type: 'checkbox', disabled: false }),
    ).toBe(false);
    expect(
      isEditableTextTarget({ tagName: 'INPUT', type: 'button', disabled: false }),
    ).toBe(false);
    expect(
      isEditableTextTarget({ tagName: 'INPUT', type: 'text', disabled: true }),
    ).toBe(false);
    expect(
      isEditableTextTarget({ tagName: 'TEXTAREA', disabled: true }),
    ).toBe(false);
    expect(isEditableTextTarget({ tagName: 'DIV' })).toBe(false);
    expect(isEditableTextTarget(null)).toBe(false);
  });

  it('includes readOnly text fields and contenteditable', () => {
    expect(
      isEditableTextTarget({
        tagName: 'INPUT',
        type: 'text',
        disabled: false,
      }),
    ).toBe(true);
    expect(
      isEditableTextTarget({
        tagName: 'DIV',
        isContentEditable: true,
      }),
    ).toBe(true);
  });

  it('resolves nested targets via closest', () => {
    const input = { tagName: 'INPUT', type: 'text', disabled: false };
    expect(
      isEditableTextTarget({
        tagName: 'SPAN',
        closest: (selector: string) =>
          selector.includes('input') ? input : null,
      }),
    ).toBe(true);
    expect(
      isEditableTextTarget({
        tagName: 'DIV',
        closest: () => null,
      }),
    ).toBe(false);
  });
});
