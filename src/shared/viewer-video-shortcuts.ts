/**
 * Main-process fallback for viewer actions whose Windows CJK IME path needs a
 * hidden Menu accelerator. The action ids and scopes come from the shortcut
 * catalog; this table only connects those actions to Renderer handlers.
 */

import {
  SHORTCUT_ACTIONS,
  type ShortcutPlatform,
} from "./shortcut-catalog";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  type ShortcutBindings,
} from "./shortcut-bindings";
import { matchesActionShortcut, resolveActionChords } from "./shortcut-resolution";

export type ViewerShortcutScope = "viewer.video" | "viewer.audio";

const RENDERER_ROUTE_BY_ACTION_ID = {
  "viewer.media.play-pause": { action: "play-pause", label: "Play / Pause" },
  "viewer.video.frame-prev": { action: "frame-prev", label: "Previous frame" },
  "viewer.video.frame-next": { action: "frame-next", label: "Next frame" },
  "viewer.video.rate-slower": { action: "rate-slower", label: "Slower playback" },
  "viewer.video.rate-faster": { action: "rate-faster", label: "Faster playback" },
  "viewer.video.seek-back": { action: "seek-back", label: "Seek backward" },
  "viewer.video.seek-forward": { action: "seek-forward", label: "Seek forward" },
} as const;

export type ViewerVideoShortcutAction =
  (typeof RENDERER_ROUTE_BY_ACTION_ID)[keyof typeof RENDERER_ROUTE_BY_ACTION_ID]["action"];

export type ViewerMainShortcutRoute = {
  readonly id: keyof typeof RENDERER_ROUTE_BY_ACTION_ID;
  readonly action: ViewerVideoShortcutAction;
  readonly label: string;
};

/** Catalog actions with both an IME fallback surface and a Renderer handler. */
export function viewerMainShortcutRoutes(
  scope: ViewerShortcutScope,
): readonly ViewerMainShortcutRoute[] {
  return SHORTCUT_ACTIONS.flatMap((definition) => {
    if (
      !definition.customizable ||
      definition.category !== "viewer" ||
      !definition.scopes.includes(scope) ||
      !definition.surfaces.includes("hidden-accelerator") ||
      !definition.surfaces.includes("before-input")
    ) {
      return [];
    }
    const route = RENDERER_ROUTE_BY_ACTION_ID[
      definition.id as keyof typeof RENDERER_ROUTE_BY_ACTION_ID
    ];
    return route ? [{ id: definition.id as ViewerMainShortcutRoute["id"], ...route }] : [];
  });
}

function isBareLetter(chord: { readonly key: string; readonly ctrlKey?: boolean; readonly metaKey?: boolean; readonly altKey?: boolean; readonly shiftKey?: boolean }): boolean {
  return /^[a-z]$/iu.test(chord.key)
    && !chord.ctrlKey && !chord.metaKey && !chord.altKey && !chord.shiftKey;
}

export function viewerVideoShortcutNeedsImeSuspension(
  bindings: ShortcutBindings,
  platform: ShortcutPlatform,
  scope: ViewerShortcutScope = "viewer.video",
): boolean {
  return viewerMainShortcutRoutes(scope).some(({ id }) =>
    resolveActionChords(id, platform, bindings).some(isBareLetter),
  );
}

export type ViewerVideoShortcutInput = {
  readonly type?: string;
  readonly code?: string;
  readonly key?: string;
  /** Electron Input.keyCode / legacy DOM keyCode. */
  readonly keyCode?: number;
  readonly control?: boolean;
  readonly ctrlKey?: boolean;
  readonly meta?: boolean;
  readonly metaKey?: boolean;
  readonly alt?: boolean;
  readonly altKey?: boolean;
  readonly shift?: boolean;
  readonly shiftKey?: boolean;
  readonly repeat?: boolean;
  readonly isAutoRepeat?: boolean;
};

function hasCtrl(input: ViewerVideoShortcutInput): boolean {
  return Boolean(input.control ?? input.ctrlKey);
}

function hasMeta(input: ViewerVideoShortcutInput): boolean {
  return Boolean(input.meta ?? input.metaKey);
}

function hasAlt(input: ViewerVideoShortcutInput): boolean {
  return Boolean(input.alt ?? input.altKey);
}

function isKeyDown(input: ViewerVideoShortcutInput): boolean {
  // Electron uses "keyDown"; DOM uses "keydown".
  const type = input.type ?? "keyDown";
  return type === "keyDown" || type === "keydown";
}

export function viewerShortcutRepeatForward(
  action: ViewerVideoShortcutAction | null,
  repeatedAction: ViewerVideoShortcutAction | null,
): { action: ViewerVideoShortcutAction; repeat: boolean } | null {
  if (action) return { action, repeat: false };
  if (repeatedAction === "seek-back" || repeatedAction === "seek-forward") {
    return { action: repeatedAction, repeat: true };
  }
  return null;
}

/** Match a catalog action from Main `before-input-event`, including IME Process events. */
export function matchViewerVideoLetterShortcut(
  input: ViewerVideoShortcutInput,
  bindings: ShortcutBindings = DEFAULT_SHORTCUT_BINDINGS,
  platform: ShortcutPlatform = "windows",
  scope: ViewerShortcutScope = "viewer.video",
): ViewerVideoShortcutAction | null {
  if (!isKeyDown(input) || input.repeat || input.isAutoRepeat) return null;
  const event = {
    key: input.key ?? "",
    ...(input.code === undefined ? {} : { code: input.code }),
    ...(input.keyCode === undefined ? {} : { keyCode: input.keyCode }),
    ctrlKey: hasCtrl(input),
    metaKey: hasMeta(input),
    altKey: hasAlt(input),
    shiftKey: Boolean(input.shift ?? input.shiftKey),
  };
  const route = viewerMainShortcutRoutes(scope).find(({ id }) =>
    matchesActionShortcut(id, event, platform, bindings),
  );
  return route?.action ?? null;
}
