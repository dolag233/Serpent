import { useEffect, useRef, useState } from "react";
import type { SerpentLibraryApi } from "../shared/library-api";

/** Compare the contained image, in physical pixels, with the decoded cover. */
export function coverNeedsMorePixels(input: {
  frameWidth: number; frameHeight: number; sourceWidth: number; sourceHeight: number;
  coverWidth: number; coverHeight: number; pixelRatio: number;
}): boolean {
  const { frameWidth, frameHeight, sourceWidth, sourceHeight, coverWidth, coverHeight } = input;
  if ([frameWidth, frameHeight, sourceWidth, sourceHeight, coverWidth, coverHeight].some((n) => !Number.isFinite(n) || n <= 0)) return false;
  const ratio = Number.isFinite(input.pixelRatio) && input.pixelRatio > 0 ? input.pixelRatio : 1;
  const scale = Math.min(1, Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight) * ratio);
  return coverWidth < Math.ceil(sourceWidth * scale) || coverHeight < Math.ceil(sourceHeight * scale);
}

export type AdaptiveCardSource = {
  api: SerpentLibraryApi;
  libraryId: string;
  assetId: string;
  revisionId: string;
  width: number;
  height: number;
};

export function AdaptiveCardImage({ alt, coverUrl, source, loadImmediately, suspendUpgrade = false, onError }: {
  alt: string; coverUrl: string; source?: AdaptiveCardSource;
  loadImmediately: boolean; onError: () => void;
  suspendUpgrade?: boolean;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [coverSize, setCoverSize] = useState({ width: 0, height: 0 });
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const [upgradeReady, setUpgradeReady] = useState(false);
  const [upgradeFailed, setUpgradeFailed] = useState(false);
  const api = source?.api;
  const libraryId = source?.libraryId;
  const assetId = source?.assetId;
  const revisionId = source?.revisionId;
  const width = source?.width ?? 0;
  const height = source?.height ?? 0;

  useEffect(() => {
    const image = imageRef.current;
    if (!image || !api || !width || !height) return;
    const update = () => {
      const rect = image.getBoundingClientRect();
      const canvas = image.closest(".workspace-canvas")?.getBoundingClientRect();
      const visible = rect.bottom > Math.max(0, canvas?.top ?? 0) && rect.top < Math.min(innerHeight, canvas?.bottom ?? innerHeight)
        && rect.right > Math.max(0, canvas?.left ?? 0) && rect.left < Math.min(innerWidth, canvas?.right ?? innerWidth);
      setNeedsUpgrade(!suspendUpgrade && visible && coverNeedsMorePixels({ frameWidth: rect.width, frameHeight: rect.height,
        sourceWidth: width, sourceHeight: height, coverWidth: coverSize.width,
        coverHeight: coverSize.height, pixelRatio: window.devicePixelRatio || 1 }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(image);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [api, width, height, coverSize, coverUrl, suspendUpgrade]);

  useEffect(() => {
    if (suspendUpgrade || !needsUpgrade || upgradeUrl || upgradeFailed || !api || !libraryId || !assetId || !revisionId) return;
    let cancelled = false;
    void api.requestPreview({ libraryId, assetId, mode: "client", intent: "viewer" }).then((result) => {
      if (!cancelled && result.ok && result.value.status === "ready" && result.value.url && result.value.url !== coverUrl) setUpgradeUrl(result.value.url);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [needsUpgrade, upgradeUrl, upgradeFailed, api, libraryId, assetId, revisionId, coverUrl, suspendUpgrade]);

  return <>
    <img ref={imageRef} alt={alt} className="asset-thumbnail" decoding="async"
      fetchPriority={loadImmediately ? "high" : "auto"} loading={loadImmediately ? "eager" : "lazy"}
      onError={onError} onLoad={(event) => setCoverSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      src={coverUrl} />
    {upgradeUrl && <img alt="" aria-hidden="true" className="asset-thumbnail adaptive-card-upgrade"
      decoding="async" src={upgradeUrl} style={{ opacity: upgradeReady && needsUpgrade ? 1 : 0 }}
      onLoad={(event) => { void event.currentTarget.decode().catch(() => undefined).then(() => setUpgradeReady(true)); }}
      onError={() => { setUpgradeUrl(null); setUpgradeReady(false); setUpgradeFailed(true); }} />}
  </>;
}
