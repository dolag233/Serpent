import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cx, mergeAriaDescribedBy } from './cx';

export type TooltipProps = {
  readonly label: string;
  readonly children: ReactNode;
  readonly variant?: 'default' | 'search-syntax';
  readonly className?: string;
};

/**
 * Adapter for the existing document-level HoverTipHost. The host owns
 * positioning, delay and portal layering; this primitive only gives a
 * control a stable semantic opt-in without exposing that implementation to
 * callers.
 */
export function Tooltip({
  children,
  className,
  label,
  variant = 'default',
}: TooltipProps): ReactNode {
  const tooltipId = `ui-tooltip-${useId().replaceAll(':', '')}`;
  const child = Children.only(children);
  if (isValidElement(child)) {
    const childProps = child.props as {
      readonly className?: string;
      readonly 'aria-describedby'?: string;
    };
    return cloneElement(child as ReactElement<Record<string, unknown>>, {
      className: cx(childProps.className, className),
      'data-hover-tip': label,
      'data-hover-tip-id': tooltipId,
      'aria-describedby': mergeAriaDescribedBy(childProps['aria-describedby'], tooltipId),
      ...(variant === 'search-syntax'
        ? { 'data-hover-tip-variant': variant }
        : {}),
    });
  }

  return (
    <span
      className={cx('ui-tooltip-target', className)}
      aria-describedby={tooltipId}
      data-hover-tip={label}
      data-hover-tip-id={tooltipId}
      {...(variant === 'search-syntax'
        ? { 'data-hover-tip-variant': variant }
        : {})}
    >
      {children}
    </span>
  );
}
