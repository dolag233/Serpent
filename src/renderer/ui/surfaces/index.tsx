import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

import { cx } from '../primitives/cx';

type SurfaceMarkerProps = {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly 'data-ui-surface-variant'?: string;
};

export type ShellSurfaceProps = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>
  & SurfaceMarkerProps;

/** Structural application shell surface. It owns no application state or chrome. */
export function ShellSurface({
  children,
  className,
  'data-ui-surface-variant': variant,
  ...rest
}: ShellSurfaceProps): ReactNode {
  return (
    <div
      {...rest}
      className={cx('ui-surface-shell', className)}
      data-ui-surface="shell"
      data-ui-surface-variant={variant}
    >
      {children}
    </div>
  );
}

export type PaneSurfaceProps = Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'>
  & SurfaceMarkerProps;

/** Structural side-pane surface; scrolling and domain contents remain caller-owned. */
export function PaneSurface({
  children,
  className,
  'data-ui-surface-variant': variant,
  ...rest
}: PaneSurfaceProps): ReactNode {
  return (
    <aside
      {...rest}
      className={cx('ui-surface-pane', className)}
      data-ui-surface="pane"
      data-ui-surface-variant={variant}
    >
      {children}
    </aside>
  );
}

type CardSurfaceBaseProps = SurfaceMarkerProps & {
  readonly variant?: 'flat' | 'raised' | 'selected';
};

export type CardSurfaceProps =
  | (Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'> & CardSurfaceBaseProps & {
      readonly as?: 'div';
    })
  | (Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> & CardSurfaceBaseProps & {
      readonly as: 'button';
    });

/**
 * Shared card surface. The `as="button"` form preserves card-specific keyboard
 * semantics without forcing all domain cards into a single component model.
 */
export function CardSurface(props: CardSurfaceProps): ReactNode {
  const {
    as = 'div',
    children,
    className,
    variant,
    'data-ui-surface-variant': markerVariant,
    ...rest
  } = props;
  const surfaceVariant = markerVariant ?? variant;
  const surfaceClassName = cx('ui-surface-card', className);

  if (as === 'button') {
    return (
      <button
        {...(rest as Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>)}
        className={surfaceClassName}
        data-ui-surface="card"
        data-ui-surface-variant={surfaceVariant}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      {...(rest as Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>)}
      className={surfaceClassName}
      data-ui-surface="card"
      data-ui-surface-variant={surfaceVariant}
    >
      {children}
    </div>
  );
}

export type ViewerSurfaceProps = Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'>
  & SurfaceMarkerProps;

/**
 * Structural viewer stage. Media policy, controls, navigation and overlays are
 * deliberately left to the domain viewer adapter.
 */
export const ViewerSurface = forwardRef<HTMLElement, ViewerSurfaceProps>(function ViewerSurface({
  children,
  className,
  'data-ui-surface-variant': variant,
  ...rest
}, ref) {
  return (
    <section
      {...rest}
      className={cx('ui-surface-viewer', className)}
      data-ui-surface="viewer"
      data-ui-surface-variant={variant}
      ref={ref}
    >
      {children}
    </section>
  );
});
