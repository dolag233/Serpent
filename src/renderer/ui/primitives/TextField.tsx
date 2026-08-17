import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

import {
  Field,
  getFieldAriaProps,
  getFieldIds,
  getFieldControlClassName,
  useFieldId,
} from './Field';
import { cx } from './cx';

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  readonly label?: ReactNode;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly loading?: boolean;
  readonly invalid?: boolean;
  readonly startAdornment?: ReactNode;
  readonly endAdornment?: ReactNode;
  readonly wrapperClassName?: string;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({
  className,
  description,
  disabled = false,
  endAdornment,
  error,
  id,
  invalid = false,
  label,
  loading = false,
  required = false,
  startAdornment,
  wrapperClassName,
  ...props
}, ref) {
  const controlId = useFieldId(id, 'ui-text-field');
  const ids = getFieldIds(controlId);
  const hasError = error !== undefined || invalid;
  const isDisabled = disabled || loading;
  const aria = getFieldAriaProps(ids, {
    hasDescription: description !== undefined,
    hasError,
  });
  const control = (
    <div className={cx('ui-text-field', wrapperClassName)}>
      {startAdornment === undefined ? null : (
        <span aria-hidden="true" className="ui-text-field__adornment ui-text-field__adornment--start">
          {startAdornment}
        </span>
      )}
      <input
        {...props}
        {...aria}
        aria-busy={loading || undefined}
        aria-required={required || undefined}
        className={getFieldControlClassName({ className, invalid: hasError, loading })}
        disabled={isDisabled}
        id={controlId}
        ref={ref}
        required={required}
        type={props.type ?? 'text'}
      />
      {endAdornment === undefined ? null : (
        <span aria-hidden="true" className="ui-text-field__adornment ui-text-field__adornment--end">
          {endAdornment}
        </span>
      )}
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
