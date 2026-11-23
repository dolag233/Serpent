import { useEffect, useState, type CSSProperties } from "react";

const delayMs = 1_000;
const timingStyle = { "--viewer-loading-delay": `${delayMs}ms` } as CSSProperties;

export function ViewerLoadingStatus({ label }: { label: string }) {
  const [announced, setAnnounced] = useState(false);
  useEffect(() => {
    // The opacity can reveal on the compositor during synchronous decoding.
    // The timer holds the live-region announcement to the same threshold.
    const timer = window.setTimeout(() => setAnnounced(true), delayMs);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      aria-hidden={!announced || undefined}
      className="preview-proxy-status viewer-loading-status"
      role="status"
      style={timingStyle}
    >
      <span aria-hidden className="activity-pulse" />
      <span>{label}</span>
    </div>
  );
}
