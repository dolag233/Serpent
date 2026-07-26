import { ContextMenuItem } from './context-menu';
import { COMMON_IMAGE_COLOR_SPACE_OPTIONS } from '../shared/image-color-space';
import { Icon } from './Icons';
import { useT } from './i18n';

interface ColorSpaceSubmenuItemsProps {
  current?: string | null;
  onPick: (colorSpace: string | null) => void;
}

/** Menu items shared by the hover submenu and any future color-space menus. */
export function ColorSpaceSubmenuItems({
  current,
  onPick,
}: ColorSpaceSubmenuItemsProps) {
  const t = useT();

  return (
    <>
      <ContextMenuItem
        icon={<Icon name="sliders" size={14} />}
        label={t('menu.colorSpaceAuto')}
        onAction={() => onPick(null)}
      />
      {COMMON_IMAGE_COLOR_SPACE_OPTIONS.map((option) => (
        <ContextMenuItem
          key={option.id}
          icon={current === option.id ? <Icon name="sliders" size={14} /> : undefined}
          label={option.label}
          onAction={() => onPick(option.id)}
        />
      ))}
    </>
  );
}
