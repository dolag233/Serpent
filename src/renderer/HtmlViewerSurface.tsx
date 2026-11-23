import { useEffect, useRef, useState } from "react";

import { useT } from "./i18n";
import { bindIframeWorkspaceMouseNav } from "./workspace-mouse-navigation";

export type HtmlViewerSurfaceProps = {
  sourceUrl: string;
  isFullscreen: boolean;
  onPresentationReady?: () => void;
};

/**
 * Serpent-8ca259: HTML viewer that embeds the source in a sandboxed iframe.
 * serpent:// custom protocol is registered with Electron and accessible from
 * the sandboxed renderer via standard navigation.
 * The component is keyed by asset in the parent, and the iframe is keyed by
 * sourceUrl so a navigation change remounts it (resetting the loading state).
 */
export function HtmlViewerSurface({
  sourceUrl,
  isFullscreen,
  onPresentationReady,
}: HtmlViewerSurfaceProps) {
  const t = useT();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const handleLoad = () => {
    onPresentationReady?.();
  };

  const handleError = () => {
    setError(t("viewer.htmlLoadFailed"));
    onPresentationReady?.();
  };

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    return bindIframeWorkspaceMouseNav(iframe);
  }, [sourceUrl]);

  return (
    <div className="html-viewer" data-fullscreen={isFullscreen ? "true" : undefined}>
      {error ? <p className="html-viewer-error">{error}</p> : null}
      <iframe
        key={sourceUrl}
        className="html-viewer-iframe"
        ref={iframeRef}
        src={sourceUrl}
        sandbox="allow-scripts allow-same-origin"
        onLoad={handleLoad}
        onError={handleError}
        title={t("viewer.htmlPreview")}
      />
    </div>
  );
}
