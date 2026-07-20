import { z } from 'zod';

/**
 * Platform edit context menu for text inputs (Serpent-d8u).
 *
 * Renderer only decides *whether* and *where* to show the menu. Main builds a
 * role-based native Menu (Undo/Cut/Copy/Paste/Delete/Select All). Electron
 * supplies platform labels/accelerators and enable/disable from the focused
 * editable element's selection / readOnly / disabled state — Renderer never
 * sends menu actions or selection payloads.
 */

const showEditContextMenuRequestSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export type ShowEditContextMenuRequest = z.infer<
  typeof showEditContextMenuRequestSchema
>;

export const SHOW_EDIT_CONTEXT_MENU_ERROR_CODES = [
  'unauthorized_sender',
  'malformed_request',
  'no_window',
] as const;

export type ShowEditContextMenuErrorCode =
  (typeof SHOW_EDIT_CONTEXT_MENU_ERROR_CODES)[number];

export type ShowEditContextMenuResult =
  | { ok: true }
  | { ok: false; code: ShowEditContextMenuErrorCode };

const showEditContextMenuResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    code: z.enum(SHOW_EDIT_CONTEXT_MENU_ERROR_CODES),
  }),
]);

export function parseShowEditContextMenuRequest(
  input: unknown,
): ShowEditContextMenuRequest | null {
  const parsed = showEditContextMenuRequestSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseShowEditContextMenuResult(
  input: unknown,
): ShowEditContextMenuResult {
  const parsed = showEditContextMenuResultSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  return { ok: false, code: 'malformed_request' };
}

/**
 * Input types that accept text editing (not buttons, checkboxes, file, etc.).
 * Empty string covers `<input>` with no type (defaults to text).
 */
export const EDITABLE_TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
]);

/** Minimal shape so detection stays unit-testable outside a DOM environment. */
export type EditableTextTargetLike = {
  tagName?: string;
  type?: string;
  disabled?: boolean;
  isContentEditable?: boolean;
  closest?: (selector: string) => EditableTextTargetLike | null;
  getAttribute?: (name: string) => string | null;
} | null;

const EDITABLE_CLOSEST_SELECTOR =
  'input, textarea, [contenteditable=""], [contenteditable="true"]';

/**
 * True when the event target is (or is inside) a text-editable control that
 * should receive the native edit context menu instead of asset/folder menus.
 * Disabled fields are excluded; readOnly fields are included (roles disable
 * mutating items).
 */
export function isEditableTextTarget(
  target: EditableTextTargetLike | EventTarget | null,
): boolean {
  if (target == null || typeof target !== 'object') return false;
  let el = target as EditableTextTargetLike & object;

  if (typeof el.closest === 'function') {
    const found = el.closest(EDITABLE_CLOSEST_SELECTOR);
    if (!found) return false;
    el = found as EditableTextTargetLike & object;
  }

  const tag = el.tagName?.toUpperCase();
  if (tag === 'TEXTAREA') return el.disabled !== true;
  if (tag === 'INPUT') {
    if (el.disabled === true) return false;
    const type = (el.type ?? 'text').toLowerCase();
    return EDITABLE_TEXT_INPUT_TYPES.has(type);
  }

  if (el.isContentEditable === true) return true;
  const attr = el.getAttribute?.('contenteditable');
  return attr === '' || attr === 'true';
}

/**
 * Plain menu template using Electron roles. Labels and accelerators are filled
 * in by Electron per platform; enable/disable follows the focused editor.
 */
export type EditContextMenuItemTemplate =
  | { type: 'separator' }
  | { role: 'undo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll' };

export function buildEditContextMenuTemplate(): EditContextMenuItemTemplate[] {
  return [
    { role: 'undo' },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'delete' },
    { type: 'separator' },
    { role: 'selectAll' },
  ];
}
