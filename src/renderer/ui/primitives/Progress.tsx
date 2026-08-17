import { useId, type HTMLAttributes, type ReactNode } from 'react';

import { cx } from './cx';

export type ProgressStatus = 'active' | 'success' | 'warning' | 'error' | 'paused';

type ProgressAccessibleName =
  | {
      readonly label: NonNullable<ReactNode>;
      readonly 'aria-label'?: string;
      readonly 'aria-labelledby'?: string;
    }
  | {
      readonly label?: ReactNode;
      readonly 'aria-label': string;
      readonly 'aria-labelledby'?: string;
    }
  | {
      readonly label?: ReactNode;
      readonly 'aria-label'?: string;
      readonly 'aria-labelledby': string;
    };

export type ProgressProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'aria-label' | 'aria-labelledby'
> & {
  readonly value?: number;
  readonly max?: number;
  readonly label?: ReactNode;
  readonly message?: ReactNode;
  readonly valueText?: string;
  readonly status?: ProgressStatus;
  readonly indeterminate?: boolean;
  readonly showValue?: boolean;
} & ProgressAccessibleName;

export function normalizeProgressValue(value: number | undefined, max: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return undefined;
  return Math.min(max, Math.max(0, value));
}

export function normalizeProgressMax(max: number): number {
  return Number.isFinite(max) && max > 0 ? max : 100;
}

export function getProgressPercentage(value: number | undefined, max = 100): number | undefined {
  const normalized = normalizeProgressValue(value, max);
  return normalized === undefined ? undefined : Math.round((normalized / max) * 100);
}

export function Progress({
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  className,
  indeterminate = false,
  label,
  max = 100,
  message,
  showValue = false,
  status = 'active',
  value,
  valueText,
  ...props
}: ProgressProps): ReactNode {
  const generatedLabelId = useId();
  const progressMax = normalizeProgressMax(max);
  const normalizedValue = indeterminate ? undefined : normalizeProgressValue(value, progressMax);
  const percentage = normalizedValue === undefined ? undefined : Math.round((normalizedValue / progressMax) * 100);
  const computedValueText = valueText ?? (percentage === undefined ? undefined : `${percentage}%`);
  const labelId = label === undefined || ariaLabelledBy !== undefined
    ? undefined
    : `ui-progress-label-${generatedLabelId}`;

  return (
    <div
      {...props}
      className={cx(
        'ui-progress',
        `ui-progress--${status}`,
        normalizedValue === undefined && 'ui-progress--indeterminate',
        className,
      )}
    >
      {label === undefined && message === undefined && !showValue ? null : (
        <div className="ui-progress__header">
          {label === undefined ? null : <span className="ui-progress__label" id={labelId}>{label}</span>}
          {message === undefined ? null : <span className="ui-progress__message">{message}</span>}
          {showValue && computedValueText !== undefined ? (
            <span className="ui-progress__value">{computedValueText}</span>
          ) : null}
        </div>
      )}
      <div
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy ?? labelId}
        aria-valuemax={progressMax}
        aria-valuemin={0}
        aria-valuenow={normalizedValue}
        aria-valuetext={computedValueText}
        className="ui-progress__track"
        role="progressbar"
      >
        <div
          aria-hidden="true"
          className="ui-progress__fill"
          style={normalizedValue === undefined ? undefined : { width: `${(normalizedValue / progressMax) * 100}%` }}
        />
      </div>
    </div>
  );
}
