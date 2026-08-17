import {
  forwardRef,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

import {
  Field,
  getFieldAriaProps,
  getFieldIds,
  getFieldControlClassName,
  useFieldId,
} from './Field';
import { cx } from './cx';

export type SelectOption = {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled?: boolean;
};

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  readonly label?: ReactNode;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly loading?: boolean;
  readonly invalid?: boolean;
  readonly options: readonly SelectOption[];
  readonly placeholder?: ReactNode;
  readonly onValueChange?: (value: string) => void;
  readonly wrapperClassName?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({
  className,
  description,
  disabled = false,
  error,
  id,
  invalid = false,
  label,
  loading = false,
  onChange,
  onValueChange,
  options,
  placeholder,
  required = false,
  wrapperClassName,
  ...props
}, ref) {
  const controlId = useFieldId(id, 'ui-select');
  const ids = getFieldIds(controlId);
  const hasError = error !== undefined || invalid;
  const isDisabled = disabled || loading;
  const aria = getFieldAriaProps(ids, {
    hasDescription: description !== undefined,
    hasError,
  });
  const control = (
    <div className={cx('ui-select', wrapperClassName)}>
      <select
        {...props}
        {...aria}
        aria-busy={loading || undefined}
        aria-required={required || undefined}
        className={getFieldControlClassName({ className, invalid: hasError, loading })}
        disabled={isDisabled}
        id={controlId}
        onChange={(event) => {
          onChange?.(event);
          onValueChange?.(event.target.value);
        }}
        ref={ref}
        required={required}
      >
        {placeholder === undefined ? null : (
          <option disabled value="">
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  return label === undefined && description === undefined && error === undefined ? control : (
    <Field
      className={wrapperClassName}
      description={description}
      error={error}
      htmlFor={controlId}
      label={label}
      required={required}
    >
      {control}
    </Field>
  );
});

export function isSelectValueAvailable(
  value: string,
  options: readonly SelectOption[],
): boolean {
  return options.some((option) => option.value === value && option.disabled !== true);
}
