import type { ReactNode } from 'react';

import type {
  PluginUiActivity,
  PluginUiDescriptor,
  PluginUiJob,
  PluginUiMenuItem,
  PluginUiNotice,
} from '../shared/plugin-ui-descriptor';
import type { PluginManagerPluginSettingSection } from '../shared/plugin-manager-api';
import {
  Activity,
  MenuSurface,
  Notice,
  resolveMenuTree,
  SettingsCard,
  StatusBadge,
  type MenuNode,
  type ResolvedMenuNode,
} from './ui/patterns';
import {
  Button as PrimitiveButton,
  Field as PrimitiveField,
  Select as PrimitiveSelect,
  Slider as PrimitiveSlider,
  Switch as PrimitiveSwitch,
  TextField as PrimitiveTextField,
} from './ui/primitives';
import {
  resolvePluginContributionConditions,
} from './plugin-menu-contributions';
import type { PluginContributionContext } from '../plugins/plugin-context';

export type PluginUiJobState = {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  completed?: number;
  total?: number;
  phase?: string;
  message?: string;
  error?: string;
};

export type PluginUiDescriptorRendererProps = {
  descriptor: PluginUiDescriptor;
  /** Render only selected Host surfaces when embedding the descriptor in a domain page. */
  surfaces?: Partial<Record<'settings' | 'menus' | 'notices' | 'activities' | 'jobs', boolean>>;
  settings?: readonly PluginManagerPluginSettingSection[];
  settingErrors?: ReadonlyMap<string, string>;
  disabled?: boolean;
  menuContext?: PluginContributionContext;
  jobs?: ReadonlyMap<string, PluginUiJobState>;
  onCommand?: (commandId: string) => void;
  onSettingChange?: (settingId: string, value: boolean | number | string) => void;
  onDismissNotice?: (noticeId: string) => void;
  onDismissActivity?: (activityId: string) => void;
  onDismissJob?: (jobId: string) => void;
};

function menuItemId(item: PluginUiMenuItem, index: number): string {
  return item.id ?? item.command ?? `item-${index + 1}`;
}

function toMenuNodes(
  items: readonly PluginUiMenuItem[],
  context: PluginContributionContext | undefined,
): MenuNode[] {
  const nodes: MenuNode[] = [];
  items.forEach((item, index) => {
    const conditions = resolvePluginContributionConditions({
      when: item.when,
      enablement: item.enablement,
      checked: item.checked,
    }, context);
    if (!conditions.visible) return;
    const id = menuItemId(item, index);
    const label = item.title ?? item.command ?? id;
    const state = {
      enablement: !conditions.disabled,
      ...(conditions.checked === undefined ? {} : { checked: conditions.checked }),
    };
    if (item.submenu !== undefined) {
      const children = toMenuNodes(item.submenu, context);
      if (children.length === 0) return;
      nodes.push({
        id,
        kind: 'submenu' as const,
        label,
        children,
        ...state,
      });
      return;
    }
    if (item.command === undefined) return;
    nodes.push({
      id,
      kind: 'item' as const,
      label,
      command: item.command,
      ...state,
    });
  });
  return nodes;
}

function renderMenuNodes(
  nodes: readonly ResolvedMenuNode[],
  shortcuts: ReadonlyMap<string, string>,
  onCommand: ((commandId: string) => void) | undefined,
): ReactNode {
  return nodes.map((node) => {
    if (node.kind === 'separator') {
      return <div aria-hidden="true" className="ui-menu-separator" key={node.id} role="separator" />;
    }
    if (node.kind === 'submenu') {
      return (
        <div className="ui-menu-submenu" key={node.id} role="none">
          <div aria-haspopup="menu" className="ui-menu-submenu__label" role="menuitem">
            <span>{node.label}</span>
            <span aria-hidden="true">›</span>
          </div>
          <MenuSurface
            aria-label={node.label}
            nodes={node.children}
            renderNode={(child) => renderMenuNodes([child], shortcuts, onCommand)}
          />
        </div>
      );
    }
    const shortcut = shortcuts.get(node.id);
    return (
      <button
        aria-checked={node.checked}
        className="ui-menu-item"
        disabled={!node.enabled}
        key={node.id}
        onClick={() => onCommand?.(node.command)}
        role={node.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        type="button"
      >
        <span>{node.label}</span>
        {shortcut === undefined ? null : <kbd>{shortcut}</kbd>}
      </button>
    );
  });
}

function collectMenuShortcuts(
  items: readonly PluginUiMenuItem[],
  shortcuts: Map<string, string>,
): void {
  items.forEach((item, index) => {
    if (item.shortcut !== undefined) shortcuts.set(menuItemId(item, index), item.shortcut);
    if (item.submenu !== undefined) collectMenuShortcuts(item.submenu, shortcuts);
  });
}

function renderSetting(
  section: PluginManagerPluginSettingSection,
  error: string | undefined,
  disabled: boolean,
  onSettingChange: ((settingId: string, value: boolean | number | string) => void) | undefined,
): ReactNode {
  const controlId = `plugin-ui-setting-${encodeURIComponent(section.id)}`;
  const field = (control: ReactNode): ReactNode => (
    <PrimitiveField
      description={section.description}
      error={error}
      htmlFor={controlId}
      key={section.id}
      label={section.title}
    >
      {control}
    </PrimitiveField>
  );
  if (section.type === 'boolean') {
    return field(
      <PrimitiveSwitch
        checked={section.value === true}
        disabled={disabled}
        id={controlId}
        onChange={(event) => onSettingChange?.(section.id, event.target.checked)}
      />,
    );
  }
  if (section.type === 'select') {
    const options = section.options ?? [];
    const value = typeof section.value === 'string' && options.some((option) => option.value === section.value)
      ? section.value
      : options[0]?.value ?? '';
    return field(
      <PrimitiveSelect
        disabled={disabled}
        id={controlId}
        onValueChange={(next) => onSettingChange?.(section.id, next)}
        options={options}
        value={value}
      />,
    );
  }
  if (section.type === 'slider') {
    const value = typeof section.value === 'number'
      ? section.value
      : typeof section.default === 'number' ? section.default : section.minimum ?? 0;
    return field(
      <PrimitiveSlider
        disabled={disabled}
        id={controlId}
        max={section.maximum}
        min={section.minimum}
        onValueChange={(next) => onSettingChange?.(section.id, next)}
        showValue
        step={section.step}
        value={value}
        valueText={String(value)}
      />,
    );
  }
  if (section.type === 'number') {
    return field(
      <PrimitiveTextField
        disabled={disabled}
        id={controlId}
        max={section.maximum}
        min={section.minimum}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value)) onSettingChange?.(section.id, value);
        }}
        type="number"
        value={typeof section.value === 'number' ? section.value : ''}
      />,
    );
  }
  return field(
    <PrimitiveTextField
      disabled={disabled}
      id={controlId}
      onChange={(event) => onSettingChange?.(section.id, event.target.value)}
      type="text"
      value={typeof section.value === 'string' ? section.value : ''}
    />,
  );
}

function renderNotice(
  notice: PluginUiNotice,
  onCommand: ((commandId: string) => void) | undefined,
  onDismiss: ((id: string) => void) | undefined,
): ReactNode {
  return (
    <Notice
      actions={notice.action === undefined ? undefined : (
        <PrimitiveButton onClick={() => onCommand?.(notice.action!.command)} size="sm">
          {notice.action.label}
        </PrimitiveButton>
      )}
      dismissible={notice.dismissible}
      key={notice.id}
      message={notice.message}
      onDismiss={() => onDismiss?.(notice.id)}
      title={notice.title}
      tone={notice.tone}
    />
  );
}

function renderActivity(
  activity: PluginUiActivity,
  onCommand: ((commandId: string) => void) | undefined,
  onDismiss: ((id: string) => void) | undefined,
): ReactNode {
  return (
    <Activity
      actions={activity.action === undefined ? undefined : (
        <PrimitiveButton onClick={() => onCommand?.(activity.action!.command)} size="sm">
          {activity.action.label}
        </PrimitiveButton>
      )}
      dismissible={activity.dismissible}
      indeterminate={activity.indeterminate}
      key={activity.id}
      message={activity.message}
      onDismiss={() => onDismiss?.(activity.id)}
      progress={activity.progress?.value}
      title={activity.title}
      tone={activity.tone}
      {...(activity.progress === undefined ? {} : { max: activity.progress.max })}
    />
  );
}

function renderJob(
  job: PluginUiJob,
  state: PluginUiJobState | undefined,
  onDismiss: ((id: string) => void) | undefined,
): ReactNode {
  const current = state ?? { status: 'queued' as const };
  const tone = current.status === 'failed'
    ? 'error'
    : current.status === 'succeeded'
      ? 'success'
      : current.status === 'cancelled' ? 'warning' : 'info';
  const hasProgress = current.total !== undefined && current.total > 0;
  const progress = hasProgress ? current.completed ?? 0 : undefined;
  const message = current.error ?? current.message ?? job.message;
  return (
    <Activity
      dismissible={job.dismissible}
      key={job.id}
      message={message}
      onDismiss={() => onDismiss?.(job.id)}
      progress={progress}
      title={job.title}
      tone={tone}
      {...(hasProgress ? { max: current.total } : {})}
    >
      <StatusBadge label={current.phase ?? current.status} tone={tone} />
    </Activity>
  );
}

export function PluginUiDescriptorRenderer({
  descriptor,
  disabled = false,
  jobs,
  menuContext,
  onCommand,
  onDismissActivity,
  onDismissJob,
  onDismissNotice,
  onSettingChange,
  settingErrors,
  settings = [],
  surfaces,
}: PluginUiDescriptorRendererProps): ReactNode {
  const renderSurface = (surface: 'settings' | 'menus' | 'notices' | 'activities' | 'jobs'): boolean => (
    surfaces?.[surface] ?? true
  );
  const settingsById = new Map(settings.map((setting) => [setting.id, setting]));
  const menuSurfaces = Object.entries(descriptor.menus ?? {}) as Array<[string, readonly PluginUiMenuItem[] | undefined]>;
  return (
    <div data-plugin-ui-descriptor-version={descriptor.version} data-ui-pattern="plugin-ui-descriptor">
      {renderSurface('settings') ? descriptor.settings?.groups.map((group) => (
        <SettingsCard description={group.description} key={group.id} title={group.title}>
          {group.items.map((item) => {
            const section = settingsById.get(item.settingId);
            return section === undefined
              ? null
              : renderSetting(section, settingErrors?.get(section.id), disabled, onSettingChange);
          })}
        </SettingsCard>
      )) : null}
      {renderSurface('menus') ? menuSurfaces.map(([surface, items]) => {
        if (items === undefined) return null;
        const nodes = resolveMenuTree(toMenuNodes(items, menuContext));
        if (nodes.length === 0) return null;
        const shortcuts = new Map<string, string>();
        collectMenuShortcuts(items, shortcuts);
        return (
          <MenuSurface
            aria-label={surface}
            key={surface}
            nodes={nodes}
            renderNode={(node) => renderMenuNodes([node], shortcuts, onCommand)}
          />
        );
      }) : null}
      {renderSurface('notices') ? descriptor.notices?.map((notice) => renderNotice(notice, onCommand, onDismissNotice)) : null}
      {renderSurface('activities') ? descriptor.activities?.map((activity) => renderActivity(activity, onCommand, onDismissActivity)) : null}
      {renderSurface('jobs') ? descriptor.jobs?.map((job) => renderJob(job, jobs?.get(job.id), onDismissJob)) : null}
    </div>
  );
}
