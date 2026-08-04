import type { HTMLAttributes, ReactNode } from 'react';

import { UI_LAYER } from '../foundation';
import { cx } from '../primitives/cx';

export interface PopoverSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  readonly children?: ReactNode;
  readonly title?: ReactNode;
  readonly labelledBy?: string;
  readonly role?: 'dialog' | 'listbox' | 'menu' | 'tooltip';
}

/** Shared non-modal overlay surface. Positioning and open state stay with the caller. */
export function PopoverSurface({
  children,
  className,
  labelledBy,
  role = 'dialog',
  title,
  ...rest
}: PopoverSurfaceProps): ReactNode {
  return (
    <div
      {...rest}
      aria-labelledby={labelledBy}
      className={cx('ui-popover-surface', className)}
      data-ui-layer={UI_LAYER.popover}
      data-ui-layer-name="popover"
      data-ui-pattern="popover-surface"
      role={role}
    >
      {title === undefined ? null : <div className="ui-popover-surface__title">{title}</div>}
      {children}
    </div>
  );
}

export interface SettingsCardProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'className' | 'title'> {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}

/** Shared settings section shell; field layout remains owned by the page. */
export function SettingsCard({
  actions,
  children,
  className,
  description,
  title,
  ...rest
}: SettingsCardProps): ReactNode {
  return (
    <section
      {...rest}
      className={cx('ui-settings-card', 'app-settings-card', className)}
      data-ui-pattern="settings-card"
    >
      {title === undefined && description === undefined && actions === undefined ? null : (
        <header className="ui-settings-card__header">
          <div className="ui-settings-card__heading">
            {title === undefined ? null : <h3>{title}</h3>}
            {description === undefined ? null : <p>{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
