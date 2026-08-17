import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';

import { Icon, type IconName } from '../../Icons';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ControlSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> & {
  readonly variant?: ButtonVariant;
  readonly size?: ControlSize;
  readonly loading?: boolean;
  readonly icon?: ReactNode;
  readonly iconName?: IconName;
  readonly iconPosition?: 'before' | 'after';
  readonly disabled?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  children,
  className,
  disabled = false,
  icon,
  iconName,
  iconPosition = 'before',
  loading = false,
  size = 'md',
  type = 'button',
  variant = 'secondary',
  ...props
}, ref) {
  const renderedIcon = icon ?? (iconName === undefined ? null : <Icon name={iconName} size={16} />);
  const isDisabled = disabled || loading;
  const content = (
    <>
      {loading ? <span aria-hidden="true" className="ui-button__spinner" /> : null}
      {iconPosition === 'before' ? renderedIcon : null}
      <span className="ui-button__label">{children}</span>
      {iconPosition === 'after' ? renderedIcon : null}
    </>
  );

  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={cx(
        'ui-button',
        `ui-button--${variant}`,
        `ui-button--${size}`,
        loading && 'ui-button--loading',
        className,
      )}
      disabled={isDisabled}
      ref={ref}
      type={type}
    >
      {content}
    </button>
  );
});

export type IconButtonProps = Omit<ButtonProps, 'children' | 'iconPosition'> & {
  readonly icon: ReactNode;
  readonly 'aria-label': string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  className,
  icon,
  ...props
}, ref) {
  return (
    <Button
      {...props}
      className={cx('ui-icon-button', className)}
      icon={icon}
      ref={ref}
    />
  );
});
