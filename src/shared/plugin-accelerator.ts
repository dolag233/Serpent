/**
 * Electron-style accelerator strings for plugin shortcut contributions.
 *
 * Parses a subset of Electron Menu accelerator tokens into chords compatible
 * with the renderer {@link matchesShortcut} matcher.
 */

import { PLATFORM_SHORTCUT_TABLE, type PlatformShortcutChord } from './platform-shortcut-table';

export type CommandPlatform = 'mac' | 'windows';

type ParsedAcceleratorChord = PlatformShortcutChord & { readonly label: string };

const MODIFIER_TOKENS = new Set([
  'command',
  'cmd',
  'commandorcontrol',
  'cmdorctrl',
  'control',
  'ctrl',
  'alt',
  'option',
  'shift',
]);

const NAMED_KEY_ALIASES: Record<string, string> = {
  plus: '+',
  minus: '-',
  space: ' ',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  delete: 'Delete',
  backspace: 'Backspace',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

function normalizeAcceleratorToken(token: string): string {
  return token.trim().toLowerCase();
}

function normalizeKeyToken(token: string): string {
  const normalized = normalizeAcceleratorToken(token);
  if (normalized.length === 1) return normalized;
  if (/^f\d{1,2}$/u.test(normalized)) return normalized.toUpperCase();
  return NAMED_KEY_ALIASES[normalized] ?? token;
}

export function parseElectronAccelerator(
  accelerator: string,
  platform: CommandPlatform,
): ParsedAcceleratorChord | null {
  const parts = accelerator.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let wantsMeta = false;
  let wantsCtrl = false;
  let wantsAlt = false;
  let wantsShift = false;
  let wantsCmdOrCtrl = false;
  let keyToken: string | undefined;

  for (const part of parts) {
    const normalized = normalizeAcceleratorToken(part);
    if (MODIFIER_TOKENS.has(normalized)) {
      switch (normalized) {
        case 'command':
        case 'cmd':
          wantsMeta = true;
          break;
        case 'commandorcontrol':
        case 'cmdorctrl':
          wantsCmdOrCtrl = true;
          break;
        case 'control':
        case 'ctrl':
          wantsCtrl = true;
          break;
        case 'alt':
        case 'option':
          wantsAlt = true;
          break;
        case 'shift':
          wantsShift = true;
          break;
      }
      continue;
    }
    if (keyToken !== undefined) return null;
    keyToken = normalizeKeyToken(part);
  }

  if (keyToken === undefined) return null;

  return {
    label: accelerator,
    key: keyToken,
    ...(wantsAlt ? { altKey: true } : {}),
    ...(wantsShift ? { shiftKey: true } : {}),
    ...(wantsCmdOrCtrl
      ? (platform === 'mac' ? { metaKey: true } : { ctrlKey: true })
      : {
        ...(wantsMeta ? { metaKey: true } : {}),
        ...(wantsCtrl ? { ctrlKey: true } : {}),
      }),
  };
}

function chordsEqual(left: PlatformShortcutChord, right: PlatformShortcutChord): boolean {
  return left.key.toLowerCase() === right.key.toLowerCase()
    && (left.metaKey ?? false) === (right.metaKey ?? false)
    && (left.ctrlKey ?? false) === (right.ctrlKey ?? false)
    && (left.altKey ?? false) === (right.altKey ?? false)
    && (left.shiftKey ?? false) === (right.shiftKey ?? false);
}

/**
 * Returns the reserved core command id when the accelerator collides with a
 * Serpent chord on either platform; otherwise null.
 */
export function findReservedAcceleratorConflict(accelerator: string): string | null {
  for (const platform of ['mac', 'windows'] as const) {
    const parsed = parseElectronAccelerator(accelerator, platform);
    if (parsed === null) continue;
    for (const row of PLATFORM_SHORTCUT_TABLE) {
      const reserved = platform === 'mac' ? row.mac : row.windows;
      if (chordsEqual(parsed, reserved)) return row.id;
    }
  }
  return null;
}

export function isValidPluginAccelerator(accelerator: string): boolean {
  return parseElectronAccelerator(accelerator, 'mac') !== null
    || parseElectronAccelerator(accelerator, 'windows') !== null;
}
