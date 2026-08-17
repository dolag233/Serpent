/**
 * Window-level mouse back/forward for workspace history (Serpent-1xmk).
 *
 * Mirrors toolbar back/forward; preview close is delegated to the callbacks.
 */

import { useEffect } from "react";

import { resolveWorkspaceMouseNavAction } from "./workspace-mouse-navigation";

export type UseWorkspaceMouseNavigationArgs = {
  readonly enabled: boolean;
  readonly onBack: () => void;
  readonly onForward: () => void;
};

export function useWorkspaceMouseNavigation(
  args: UseWorkspaceMouseNavigationArgs,
): void {
  const { enabled, onBack, onForward } = args;

  useEffect(() => {
    if (!enabled) return;

    const onPointerDown = (event: PointerEvent) => {
      const action = resolveWorkspaceMouseNavAction(event);
      if (!action) return;
      event.preventDefault();
      if (action === "back") onBack();
      else onForward();
    };

    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () =>
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [enabled, onBack, onForward]);
}
