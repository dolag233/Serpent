import type { HTMLAttributes, ReactNode } from "react";

/** A stable entry in the host's modal stack. */
export interface DialogStackEntry {
  readonly id: string;
  /** Closed entries stay in the caller's state but are not eligible for topmost selection. */
  readonly open?: boolean;
  readonly modal?: boolean;
}

/**
 * Selects the last open dialog in stack order.
 *
 * The helper intentionally does not inspect React state or the DOM. The owner of
 * the dialog state supplies the stack order, which keeps focus and Escape
 * handling deterministic for nested dialogs.
 */
export function getTopmostDialog<T extends DialogStackEntry>(
  entries: readonly T[],
): T | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.open !== false) {
      return entry;
    }
  }
  return undefined;
}

/** Alias that reads naturally at call sites that only need the selected id. */
export const selectTopmostDialog = getTopmostDialog;

export function isTopmostDialog(
  dialogId: string,
  entries: readonly DialogStackEntry[],
): boolean {
  return getTopmostDialog(entries)?.id === dialogId;
}

export interface DialogFocusBoundary {
  readonly root: HTMLElement;
  readonly firstFocusable: HTMLElement | null;
  readonly lastFocusable: HTMLElement | null;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

/**
 * Returns the focus boundary for one dialog without moving focus.
 *
 * Focus movement and trapping remain the responsibility of the existing host
 * focus controller. This only gives that controller the top-level element and
 * its current first/last focusable descendants.
 */
export function getDialogFocusBoundary(
  dialog: HTMLElement | null,
): DialogFocusBoundary | null {
  if (!dialog) {
    return null;
  }

  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );

  return {
    root: dialog,
    firstFocusable: focusable[0] ?? null,
    lastFocusable: focusable.at(-1) ?? null,
  };
}

export interface ModalStackProps extends HTMLAttributes<HTMLDivElement> {
  readonly children?: ReactNode;
  readonly entries?: readonly DialogStackEntry[];
  /** Pass this when the owner already resolved the topmost id. */
  readonly topmostDialogId?: string;
}

/**
 * Structural wrapper for a stack of dialogs.
 *
 * It deliberately does not own open/close state, portals, Escape handling, or
 * focus movement. Those behaviors are application concerns and are composed
 * around this stable DOM contract.
 */
export function ModalStack({
  children,
  entries = [],
  topmostDialogId,
  className,
  ...rest
}: ModalStackProps) {
  const resolvedTopmostId =
    topmostDialogId ?? getTopmostDialog(entries)?.id ?? undefined;

  return (
    <div
      {...rest}
      className={className ? `ui-modal-stack ${className}` : "ui-modal-stack"}
      data-ui-pattern="modal-stack"
      data-topmost-dialog-id={resolvedTopmostId}
      data-dialog-count={entries.length}
    >
      {children}
    </div>
  );
}

export interface DialogShellProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly dialogId: string;
  readonly children?: ReactNode;
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly footer?: ReactNode;
  readonly headerActions?: ReactNode;
  readonly contentClassName?: string;
  readonly open?: boolean;
  readonly modal?: boolean;
  /** Only the topmost dialog may consume Escape. ModalStack owners can set this explicitly. */
  readonly isTopmost?: boolean;
  readonly onRequestClose?: () => void;
}

/**
 * Semantic dialog surface. It provides structure and ARIA relationships only;
 * sizing, placement, animation, and close policy remain host-owned.
 */
export function DialogShell({
  dialogId,
  children,
  title,
  description,
  footer,
  headerActions,
  contentClassName,
  open = true,
  modal = true,
  isTopmost = true,
  onRequestClose,
  className,
  id,
  ...rest
}: DialogShellProps) {
  const titleId = title ? `${dialogId}-title` : undefined;
  const descriptionId = description ? `${dialogId}-description` : undefined;

  return (
    <div
      {...rest}
      id={id ?? dialogId}
      className={className ? `ui-dialog-shell ${className}` : "ui-dialog-shell"}
      data-ui-pattern="dialog-shell"
      data-dialog-id={dialogId}
      data-dialog-open={open ? "true" : "false"}
      data-dialog-topmost={isTopmost ? "true" : "false"}
      hidden={!open}
      role="dialog"
      aria-modal={modal || undefined}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        if (open && event.key === "Escape" && isTopmost && onRequestClose) {
          event.preventDefault();
          event.stopPropagation();
          onRequestClose();
        }
        rest.onKeyDown?.(event);
      }}
    >
      {(title || description || headerActions) && (
        <header data-dialog-header="true">
          <div className="ui-dialog-shell__heading">
            {title && <h2 id={titleId}>{title}</h2>}
            {headerActions}
          </div>
          {description && <p id={descriptionId}>{description}</p>}
        </header>
      )}
      <div className={contentClassName} data-dialog-content="true">
        {children}
      </div>
      {footer && <footer data-dialog-footer="true">{footer}</footer>}
    </div>
  );
}

/** Keeps the boundary selector private while allowing focused tests/consumers to identify it. */
export const dialogFocusableSelector = FOCUSABLE_SELECTOR;
