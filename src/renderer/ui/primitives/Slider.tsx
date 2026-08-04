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
import { cx } from './cx';

export type SliderProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'defaultValue' | 'onChange' | 'size' | 'type' | 'value'
> & {
  readonly label?: ReactNode;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly loading?: boolean;
  readonly invalid?: boolean;
  readonly value?: number;
  readonly defaultValue?: number;
  readonly valueText?: string;
  readonly showValue?: boolean;
  readonly onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onValueChange?: (value: number) => void;
  readonly wrapperClassName?: string;
};

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider({
  className,
  defaultValue,
  description,
  disabled = false,
  error,
  id,
  invalid = false,
  label,
  loading = false,
  max,
  min,
  onChange,
  onValueChange,
  required = false,
  showValue = false,
  step,
  value,
  valueText,
  wrapperClassName,
  ...props
}, ref) {
  const controlId = useFieldId(id, 'ui-slider');
  const ids = getFieldIds(controlId);
  const hasError = error !== undefined || invalid;
  const isDisabled = disabled || loading;
  const aria = getFieldAriaProps(ids, {
    hasDescription: description !== undefined,
    hasError,
  });
  const displayValue = valueText ?? (value === undefined ? undefined : String(value));
  const control = (
    <div className={cx('ui-slider', wrapperClassName)}>
      <input
        {...props}
        {...aria}
        aria-busy={loading || undefined}
        aria-required={required || undefined}
        aria-valuetext={valueText}
        className={cx('ui-slider__control', className)}
        defaultValue={defaultValue}
        disabled={isDisabled}
        id={controlId}
        max={max}
        min={min}
        onChange={(event) => {
          onChange?.(event);
          onValueChange?.(Number(event.target.value));
        }}
        ref={ref}
        required={required}
        step={step}
        type="range"
        value={value}
      />
      {showValue && displayValue !== undefined ? (
        <output className="ui-slider__value" htmlFor={controlId}>{displayValue}</output>
      ) : null}
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
