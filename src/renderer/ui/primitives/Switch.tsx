import {
  forwardRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

import {
  Field,
  getFieldAriaProps,
  getFieldIds,
  useFieldId,
} from './Field';
import { cx, mergeAriaDescribedBy } from './cx';

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
  readonly label?: ReactNode;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly loading?: boolean;
  readonly invalid?: boolean;
  readonly checked?: boolean;
  readonly defaultChecked?: boolean;
  readonly onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onCheckedChange?: (checked: boolean) => void;
  readonly wrapperClassName?: string;
};

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch({
  checked,
  className,
  defaultChecked,
  description,
  disabled = false,
  error,
  id,
  invalid = false,
  label,
  loading = false,
  onChange,
  onCheckedChange,
  required = false,
  wrapperClassName,
  ...props
}, ref) {
  const controlId = useFieldId(id, 'ui-switch');
  const ids = getFieldIds(controlId);
  const hasError = error !== undefined || invalid;
  const isDisabled = disabled || loading;
  const aria = getFieldAriaProps(ids, {
    hasDescription: description !== undefined,
    hasError,
  });
  const input = (
    <span className={cx('ui-switch', wrapperClassName)}>
      <input
        {...props}
        {...aria}
        aria-busy={loading || undefined}
        aria-checked={checked}
        aria-required={required || undefined}
        className={cx('ui-switch__input', className)}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={isDisabled}
        id={controlId}
        onChange={(event) => {
          onChange?.(event);
          onCheckedChange?.(event.target.checked);
        }}
        ref={ref}
        role="switch"
        type="checkbox"
      />
      <span aria-hidden="true" className="ui-switch__track">
        <span className="ui-switch__thumb" />
      </span>
    </span>
  );

  if (label === undefined && description === undefined && error === undefined) return input;

  return (
    <Field
      className={wrapperClassName}
      description={description}
      error={error}
      htmlFor={controlId}
      label={label}
      required={required}
    >
      {input}
    </Field>
  );
});

export function getSwitchDescriptionIds(
  controlId: string,
  options: { readonly hasDescription?: boolean; readonly hasError?: boolean },
): string | undefined {
  const ids = getFieldIds(controlId);
  return mergeAriaDescribedBy(
    options.hasDescription ? ids.descriptionId : undefined,
    options.hasError ? ids.errorId : undefined,
  );
}
