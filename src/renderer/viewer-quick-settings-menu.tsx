import type { ReactNode } from "react";

import { ContextMenuSubmenu } from "./context-menu";
import { Icon } from "./Icons";
import { useT } from "./i18n";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";
import type { VideoSeekJumpMode } from "./video-seek-jump-preferences";

export type ViewerPlaybackMenuProps = {
  seconds: number;
  percent: number;
  mode: VideoSeekJumpMode;
  fasterShortcut?: string | null;
  slowerShortcut?: string | null;
  seekForwardShortcut?: string | null;
  seekBackShortcut?: string | null;
  onFaster?: () => void;
  onSlower?: () => void;
  onSeek: (direction: 1 | -1, unit: VideoSeekJumpMode) => void;
  onToggleMode: () => void;
};

/** Which viewers get the shared 「播放」 submenu. Rate exists only where the player changes speed. */
export function viewerShowsPlaybackMenu(input: {
  mediaType?: string | null;
  gif?: boolean;
}): { seek: true; rate: boolean } | null {
  if (input.mediaType === "video" || input.gif === true) {
    return { seek: true, rate: true };
  }
  if (input.mediaType === "audio") return { seek: true, rate: false };
  return null;
}

export type ViewerChromeMenuProps = {
  toolbarOnApproach: boolean;
  arrowsOnApproach: boolean;
  onToggleToolbar: () => void;
  onToggleArrows: () => void;
};

function MenuRow({
  label,
  shortcut,
  active = false,
  checkable = false,
  onClick,
}: {
  label: string;
  shortcut?: string | null;
  active?: boolean;
  checkable?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-checked={checkable ? active : undefined}
      className={`context-menu-item${active ? " is-active" : ""}`}
      onClick={onClick}
      role={checkable ? "menuitemcheckbox" : "menuitem"}
      tabIndex={VIEWER_CHROME_TAB_INDEX}
      type="button"
    >
      <span className="context-menu-item-label">{label}</span>
      {shortcut ? <span className="context-menu-item-shortcut">{shortcut}</span> : null}
    </button>
  );
}

export function ViewerQuickSettingsMenu({
  playback,
  chrome,
  onClose,
}: {
  playback?: ViewerPlaybackMenuProps | null;
  chrome?: ViewerChromeMenuProps | null;
  onClose: () => void;
}): ReactNode {
  const t = useT();
  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  const timeShortcut = playback?.mode === "time";
  return (
    <>
      {playback ? (
        <ContextMenuSubmenu
          icon={<Icon name="play" size={14} />}
          label={t("preview.playbackMenu")}
        >
          {playback.onFaster && playback.onSlower ? (
            <>
              <MenuRow
                label={t("preview.playbackFaster")}
                onClick={run(playback.onFaster)}
                shortcut={playback.fasterShortcut}
              />
              <MenuRow
                label={t("preview.playbackSlower")}
                onClick={run(playback.onSlower)}
                shortcut={playback.slowerShortcut}
              />
            </>
          ) : null}
          <MenuRow
            label={t("preview.seekForwardSeconds", { seconds: playback.seconds })}
            onClick={run(() => playback.onSeek(1, "time"))}
            shortcut={timeShortcut ? playback.seekForwardShortcut : null}
          />
          <MenuRow
            label={t("preview.seekBackSeconds", { seconds: playback.seconds })}
            onClick={run(() => playback.onSeek(-1, "time"))}
            shortcut={timeShortcut ? playback.seekBackShortcut : null}
          />
          <MenuRow
            label={t("preview.seekForwardPercent", { percent: playback.percent })}
            onClick={run(() => playback.onSeek(1, "percent"))}
            shortcut={timeShortcut ? null : playback.seekForwardShortcut}
          />
          <MenuRow
            label={t("preview.seekBackPercent", { percent: playback.percent })}
            onClick={run(() => playback.onSeek(-1, "percent"))}
            shortcut={timeShortcut ? null : playback.seekBackShortcut}
          />
          <MenuRow
            label={
              playback.mode === "time"
                ? t("preview.seekJumpUsePercent")
                : t("preview.seekJumpUseTime")
            }
            onClick={run(playback.onToggleMode)}
          />
        </ContextMenuSubmenu>
      ) : null}
      {chrome ? (
        <ContextMenuSubmenu
          icon={<Icon name="settings" size={14} />}
          label={t("preview.viewerOtherMenu")}
        >
          <MenuRow
            active={chrome.toolbarOnApproach}
            checkable
            label={`${chrome.toolbarOnApproach ? t("preview.settingStateOn") : t("preview.settingStateOff")} ${t("settings.videoTransportOnApproach")}`}
            onClick={run(chrome.onToggleToolbar)}
          />
          <MenuRow
            active={chrome.arrowsOnApproach}
            checkable
            label={`${chrome.arrowsOnApproach ? t("preview.settingStateOn") : t("preview.settingStateOff")} ${t("settings.viewerNavOnApproach")}`}
            onClick={run(chrome.onToggleArrows)}
          />
        </ContextMenuSubmenu>
      ) : null}
    </>
  );
}
