import { useT } from "./i18n";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";

export interface ProxyPlaybackNoticeProps {
  visible: boolean;
  onHide: () => void;
  onShow: () => void;
}

/** Low-presence explanation for a viewer that had to fall back to a proxy. */
export function ProxyPlaybackNotice({
  visible,
  onHide,
  onShow,
}: ProxyPlaybackNoticeProps) {
  const t = useT();
  if (visible) {
    return (
      // preview-chrome-fade: 随查看器 UI 一起在鼠标停驻时渐隐（Serpent-d259bc）。
      <div className="preview-proxy-notice preview-chrome-fade" role="status">
        <span>{t("preview.proxyPlaybackNotice")}</span>
        <button
          aria-label={t("preview.hideProxyPlaybackNotice")}
          onClick={onHide}
          tabIndex={VIEWER_CHROME_TAB_INDEX}
          type="button"
        >
          {t("preview.hideProxyPlaybackNotice")}
        </button>
      </div>
    );
  }
  return (
    <button
      aria-label={t("preview.showProxyPlaybackNotice")}
      className="preview-proxy-notice-restore preview-chrome-fade"
      onClick={onShow}
      tabIndex={VIEWER_CHROME_TAB_INDEX}
      type="button"
    >
      {t("preview.showProxyPlaybackNotice")}
    </button>
  );
}
