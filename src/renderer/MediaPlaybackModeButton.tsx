import { Icon } from './Icons';
import { useT } from './i18n';
import { iconActionAttrs } from './icon-action-attrs';
import { nextMediaPlaybackMode, type MediaPlaybackMode } from './media-playback-mode';
import { VIEWER_CHROME_TAB_INDEX } from './viewer-focus-policy';

export function MediaPlaybackModeButton({ mode, onChange, onInteract }: {
  mode: MediaPlaybackMode;
  onChange: (mode: MediaPlaybackMode) => void;
  onInteract?: () => void;
}) {
  const t = useT();
  return <button
    className="preview-video-fit"
    type="button"
    tabIndex={VIEWER_CHROME_TAB_INDEX}
    {...iconActionAttrs(t('preview.playbackMode', { mode: t(`preview.playbackModes.${mode}`) }))}
    onClick={() => { onInteract?.(); onChange(nextMediaPlaybackMode(mode)); }}
  ><Icon name={mode === 'repeat-one' ? 'repeat-one' : mode === 'sequential' ? 'list-play' : 'stop'} size={16} /></button>;
}
