import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type TransitionEvent,
} from "react";
import {
  createToastNotifications,
  type ToastNotifications,
  type ToastSnapshot,
} from "./toast-notifications";

export interface UseToastNotificationsReturn extends ToastSnapshot {
  /** Drop-in replacement for the former `setError` state setter. */
  setError: (text: string | null) => void;
  setWarning: (text: string | null) => void;
  /** Drop-in replacement for the former `setNotice` state setter. */
  setNotice: (text: string | null) => void;
  /** Blocking fatal modal body; null clears. */
  setFatal: (text: string | null) => void;
  /** Clear only the currently visible toast channel (not fatal). */
  dismissVisible: () => void;
  /** Attach to the toast element's onTransitionEnd. */
  handleToastTransitionEnd: (event: TransitionEvent) => void;
}

/**
 * Binds the toast notification controller (toast-notifications.ts) to React.
 * The closing lifecycle — exit transition first, unmount only after it ends —
 * lives in the controller; this hook only exposes the snapshot and stable
 * callbacks (REQ-SHELL-010 / Serpent-99lv).
 */
export function useToastNotifications(): UseToastNotificationsReturn {
  const [controller] = useState<ToastNotifications>(() =>
    createToastNotifications(),
  );
  useEffect(() => () => controller.dispose(), [controller]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const handleToastTransitionEnd = useCallback(
    (event: TransitionEvent) => {
      if (event.propertyName === "opacity") controller.finishExit();
    },
    [controller],
  );
  return {
    ...snapshot,
    setError: controller.setError,
    setWarning: controller.setWarning,
    setNotice: controller.setNotice,
    setFatal: controller.setFatal,
    dismissVisible: controller.dismissVisible,
    handleToastTransitionEnd,
  };
}
