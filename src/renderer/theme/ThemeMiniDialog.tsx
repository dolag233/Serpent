import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createShellPortal } from '../ui/ShellStyleScope';

import { isImeKeyboardEvent } from '../ime-safe-dismiss';
import { DialogShell } from '../ui/patterns';
import { Button } from '../ui/primitives';

/**
 * Small modal stacked over the settings dialog (a94): new-theme name and
 * delete confirmation. Escape / Cancel close only this dialog — key events
 * stop here so the settings dialog underneath stays open.
 */
export function ThemeMiniDialog({
  children,
  confirmLabel,
  cancelLabel,
  confirmDisabled = false,
  danger = false,
  dialogId,
  onCancel,
  onConfirm,
  title,
}: {
  readonly children?: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly confirmDisabled?: boolean;
  readonly danger?: boolean;
  readonly dialogId: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = ref.current;
    const target = root?.querySelector<HTMLElement>('input') ?? root?.querySelector<HTMLElement>('button[data-dialog-default-action="true"]');
    target?.focus();
    if (target instanceof HTMLInputElement) target.select();
  }, []);
  // App dialogs dismiss on a document capture-phase Escape listener, which
  // would close Settings underneath. Window capture runs first: Escape here
  // closes only this dialog.
  const cancelRef = useRef(onCancel);
  useLayoutEffect(() => {
    cancelRef.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isImeKeyboardEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      cancelRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
  if (typeof document === 'undefined') return null;
  return createShellPortal(
    <div
      className="dialog-backdrop theme-mini-dialog-backdrop"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (isImeKeyboardEvent(event)) return;
        if (event.key === 'Enter' && !confirmDisabled) {
          event.preventDefault();
          onConfirm();
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      ref={ref}
    >
      <DialogShell
        className="theme-mini-dialog"
        dialogId={dialogId}
        footer={(
          <div className="theme-mini-dialog-actions">
            <Button onClick={onCancel} size="sm">{cancelLabel}</Button>
            <Button
              data-dialog-default-action="true"
              disabled={confirmDisabled}
              onClick={onConfirm}
              size="sm"
              variant={danger ? 'danger' : 'primary'}
            >
              {confirmLabel}
            </Button>
          </div>
        )}
        title={title}
      >
        {children}
      </DialogShell>
    </div>,
    document.body,
  );
}
