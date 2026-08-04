import { useState, type ReactNode } from 'react';

import { Icon } from '../../Icons';
import { cx } from '../primitives/cx';

export type SettingsDisclosureProps = {
  readonly title: ReactNode;
  readonly hint?: ReactNode;
  /** Initial state; disclosure state is not persisted across remounts. */
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
};

/**
 * Collapsible settings section. The header stays in the layout when the
 * section is collapsed so the settings page reads as a stable outline;
 * long blocks (wallpaper, custom colors) are tucked away by default.
 */
export function SettingsDisclosure({
  title,
  hint,
  defaultOpen = false,
  children,
}: SettingsDisclosureProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="app-settings-disclosure">
      <button
        aria-expanded={open}
        className="app-settings-disclosure-header"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="app-settings-row-copy">
          <strong>{title}</strong>
          {hint === undefined ? null : <span>{hint}</span>}
        </span>
        <span
          aria-hidden="true"
          className={cx('app-settings-disclosure-chevron', open && 'is-open')}
        >
          <Icon name="chevron" size={16} />
        </span>
      </button>
      {open ? <div className="app-settings-disclosure-content">{children}</div> : null}
    </section>
  );
}
