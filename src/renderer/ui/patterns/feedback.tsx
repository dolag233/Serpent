import type { HTMLAttributes, ReactNode } from 'react';

import { UI_LAYER } from '../foundation';
import {
  Progress,
  type ProgressStatus,
  normalizeProgressMax,
  normalizeProgressValue,
} from '../primitives/Progress';
import { cx } from '../primitives/cx';

export type FeedbackTone = 'info' | 'success' | 'warning' | 'error';
export type FeedbackRole = 'status' | 'alert';

interface FeedbackContentProps {
  readonly tone?: FeedbackTone;
  readonly role?: FeedbackRole;
  readonly title?: ReactNode;
  readonly message?: ReactNode;
  readonly leading?: ReactNode;
}

interface FeedbackDismissProps {
  readonly dismissible?: boolean;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
  readonly actions?: ReactNode;
}

type FeedbackSurfaceProps = FeedbackContentProps & FeedbackDismissProps & {
  readonly children?: ReactNode;
  readonly className?: string;
};

type NoticeAttributes = Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'className' | 'role' | 'title' | 'aria-live'
>;

export type NoticeProps = NoticeAttributes & FeedbackSurfaceProps;

type ActivityAttributes = Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'className' | 'role' | 'title' | 'aria-live'
>;

export type ActivityProps = ActivityAttributes & FeedbackSurfaceProps & {
  readonly progress?: number;
  readonly max?: number;
  readonly indeterminate?: boolean;
  readonly progressLabel?: ReactNode;
  readonly progressAriaLabel?: string;
  readonly valueText?: string;
};

type StatusBadgeAttributes = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'children' | 'className' | 'role' | 'title' | 'aria-live'
>;

export type StatusBadgeProps = StatusBadgeAttributes & FeedbackContentProps & {
  readonly label?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
};

function getLiveRegionRole(tone: FeedbackTone, role: FeedbackRole | undefined): FeedbackRole {
  return role ?? (tone === 'warning' || tone === 'error' ? 'alert' : 'status');
}

function getLiveRegionProps(tone: FeedbackTone, role: FeedbackRole | undefined) {
  const resolvedRole = getLiveRegionRole(tone, role);
  return {
    role: resolvedRole,
    'aria-live': resolvedRole === 'alert' ? 'assertive' as const : 'polite' as const,
    'aria-atomic': true as const,
  };
}

function renderFeedbackBody({ title, message, children }: FeedbackSurfaceProps): ReactNode {
  return (
    <div className="ui-feedback__body">
      {title === undefined ? null : <strong className="ui-feedback__title">{title}</strong>}
      {message === undefined ? null : <span className="ui-feedback__message">{message}</span>}
      {children}
    </div>
  );
}

function renderDismissButton({ dismissible, dismissLabel, onDismiss }: FeedbackDismissProps): ReactNode {
  if (!dismissible) return null;

  return (
    <button
      aria-label={dismissLabel ?? 'Dismiss'}
      className="ui-feedback__dismiss"
      onClick={onDismiss}
      type="button"
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}

function renderFeedbackActions({ actions, dismissible, dismissLabel, onDismiss }: FeedbackSurfaceProps): ReactNode {
  if (!actions && !dismissible) return null;
  return (
    <div className="ui-feedback__actions">
      {actions}
      {renderDismissButton({ dismissible, dismissLabel, onDismiss })}
    </div>
  );
}

export function Notice({
  actions,
  children,
  className,
  dismissible = false,
  dismissLabel,
  leading,
  message,
  onDismiss,
  role,
  title,
  tone = 'info',
  ...rest
}: NoticeProps): ReactNode {
  const liveRegionProps = getLiveRegionProps(tone, role);

  return (
    <div
      {...rest}
      {...liveRegionProps}
      className={cx('ui-feedback', 'ui-notice', `ui-feedback--${tone}`, className)}
      data-ui-layer={UI_LAYER.notice}
      data-ui-layer-name="notice"
      data-ui-pattern="notice"
      data-ui-tone={tone}
    >
      {leading}
      {renderFeedbackBody({ children, message, title, tone })}
      {renderFeedbackActions({ actions, dismissible, dismissLabel, onDismiss })}
    </div>
  );
}

function getActivityProgressStatus(tone: FeedbackTone): ProgressStatus {
  return tone === 'error' ? 'error' : tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'active';
}

function getProgressAriaLabel(title: ReactNode, progressAriaLabel: string | undefined): string {
  if (progressAriaLabel !== undefined) return progressAriaLabel;
  if (typeof title === 'string' || typeof title === 'number') return String(title);
  return 'Activity progress';
}

export function Activity({
  actions,
  children,
  className,
  dismissible = false,
  dismissLabel,
  indeterminate = false,
  leading,
  max = 100,
  message,
  onDismiss,
  progress,
  progressAriaLabel,
  progressLabel,
  role,
  title,
  tone = 'info',
  valueText,
  ...rest
}: ActivityProps): ReactNode {
  const liveRegionProps = getLiveRegionProps(tone, role);
  const progressMax = normalizeProgressMax(max);
  const normalizedProgress = indeterminate ? undefined : normalizeProgressValue(progress, progressMax);
  const hasProgress = indeterminate || progress !== undefined;

  return (
    <div
      {...rest}
      {...liveRegionProps}
      aria-busy={hasProgress && !indeterminate ? normalizedProgress !== progressMax : hasProgress}
      className={cx('ui-feedback', 'ui-activity', `ui-feedback--${tone}`, className)}
      data-ui-layer={UI_LAYER.activity}
      data-ui-layer-name="activity"
      data-ui-pattern="activity"
      data-ui-tone={tone}
    >
      {leading}
      {renderFeedbackBody({ children, message, title, tone })}
      {hasProgress ? (
        <Progress
          aria-label={getProgressAriaLabel(title, progressAriaLabel)}
          indeterminate={indeterminate}
          label={progressLabel}
          max={progressMax}
          showValue={valueText !== undefined}
          status={getActivityProgressStatus(tone)}
          value={progress}
          valueText={valueText}
        />
      ) : null}
      {renderFeedbackActions({ actions, dismissible, dismissLabel, onDismiss })}
    </div>
  );
}

export function StatusBadge({
  children,
  className,
  label,
  role = 'status',
  title,
  tone = 'info',
  ...rest
}: StatusBadgeProps): ReactNode {
  const liveRegionProps = getLiveRegionProps(tone, role);

  return (
    <span
      {...rest}
      {...liveRegionProps}
      className={cx('ui-feedback', 'ui-status-badge', `ui-feedback--${tone}`, className)}
      data-ui-pattern="status-badge"
      data-ui-tone={tone}
      title={title === undefined ? undefined : String(title)}
    >
      {label ?? children}
    </span>
  );
}
