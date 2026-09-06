import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { isImeKeyboardEvent } from "./ime-safe-dismiss";
import { PortaledPopover } from "./PortaledPopover";
import {
  focusFirstRovingItem,
  handleRovingListKeyDown,
  ROVING_OPTION_SELECTOR,
} from "./roving-list-keyboard";
import {
  Field,
  getFieldAriaProps,
  getFieldControlClassName,
  getFieldIds,
  useFieldId,
  type SelectOption,
} from "./ui/primitives";
import { cx } from "./ui/primitives/cx";

/**
 * Widget-dialog select. Native `<select>` popups fail inside
 * `dialog-backdrop` (`backdrop-filter` + `overflow`) on Chromium/Electron.
 * Reuse PortaledPopover + Field chrome, and paint on the tooltip layer so
 * the menu sits above the modal.
 */
export function PluginWidgetSelect({
  description,
  disabled = false,
  id,
  label,
  onValueChange,
  options,
  value,
}: {
  readonly description?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly label?: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly value: string;
}): ReactNode {
  const controlId = useFieldId(id, "plugin-widget-select");
  const ids = getFieldIds(controlId);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [menuWidth, setMenuWidth] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? (options.length > 0 ? options[0] : undefined);
  const selectedLabel = selected?.label ?? value;

  useLayoutEffect(() => {
    if (!open) return;
    const width = rootRef.current?.getBoundingClientRect().width ?? 0;
    if (width > 0) setMenuWidth(width);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let swallowScrimClick = false;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-dimension-filter-popover]")) return;
      if (rootRef.current?.contains(event.target) === true) return;
      setOpen(false);
      const onScrim = event.target.closest(".plugin-ui-dialog-stage") !== null
        && event.target.closest(".ui-dialog-shell") === null;
      if (!onScrim) return;
      swallowScrimClick = true;
      event.preventDefault();
      event.stopPropagation();
    };
    const onClick = (event: MouseEvent) => {
      if (!swallowScrimClick) return;
      swallowScrimClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    const raf = requestAnimationFrame(() => {
      const list = document.getElementById(listId);
      if (list instanceof HTMLElement) {
        focusFirstRovingItem(list, ROVING_OPTION_SELECTOR);
      }
    });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown, true);
      cancelAnimationFrame(raf);
    };
  }, [listId, open]);

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (isImeKeyboardEvent(event.nativeEvent)) return;
    const result = handleRovingListKeyDown({
      key: event.key,
      container: event.currentTarget,
      itemSelector: ROVING_OPTION_SELECTOR,
    });
    if (!result.handled) return;
    event.preventDefault();
    event.stopPropagation();
    if (result.action === "escape") setOpen(false);
  }

  function pick(next: string) {
    setOpen(false);
    if (next !== value) onValueChange(next);
  }

  const aria = getFieldAriaProps(ids, {
    hasDescription: description !== undefined,
    hasError: false,
  });
  const control = (
    <div className="ui-select" ref={rootRef}>
      <button
        {...aria}
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cx(getFieldControlClassName({}), "plugin-widget-select-trigger")}
        disabled={disabled}
        id={controlId}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {selectedLabel}
      </button>
      {open ? (
        <PortaledPopover
          anchorRef={rootRef}
          className="ui-menu-surface plugin-widget-select-menu"
          id={listId}
          layer="tooltip"
          onKeyDown={onListKeyDown}
          role="listbox"
          style={menuWidth > 0 ? { minWidth: menuWidth } : undefined}
        >
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={option.value === value ? "is-selected" : undefined}
              disabled={option.disabled}
              key={option.value}
              onClick={() => pick(option.value)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </PortaledPopover>
      ) : null}
    </div>
  );

  return label === undefined && description === undefined ? control : (
    <Field description={description} htmlFor={controlId} label={label}>
      {control}
    </Field>
  );
}
