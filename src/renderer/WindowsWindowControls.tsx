import { useEffect, useState, type ReactElement } from "react";

import { useT } from "./i18n";
import type { SerpentShellApi } from "../shared/external-url";
import type { WindowControlAction } from "../shared/window-controls";

type ShellBridge = Pick<
  SerpentShellApi,
  "windowControl" | "onWindowMaximizedChanged"
>;

function CaptionIcon({ kind }: { kind: "minimize" | "maximize" | "restore" | "close" }): ReactElement {
  // Stroke glyphs sized to read like Win10/11 caption icons at 10px.
  if (kind === "minimize") {
    return (
      <svg aria-hidden="true" className="windows-caption-glyph" viewBox="0 0 10 10">
        <path d="M1 5h8" fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
    );
  }
  if (kind === "maximize") {
    return (
      <svg aria-hidden="true" className="windows-caption-glyph" viewBox="0 0 10 10">
        <rect
          fill="none"
          height="7"
          stroke="currentColor"
          strokeWidth="1"
          width="7"
          x="1.5"
          y="1.5"
        />
      </svg>
    );
  }
  if (kind === "restore") {
    return (
      <svg aria-hidden="true" className="windows-caption-glyph" viewBox="0 0 10 10">
        <path
          d="M3 3.5h4.5V8H3z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
        <path
          d="M4.5 2h4.5v4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="windows-caption-glyph" viewBox="0 0 10 10">
      <path d="M2 2l6 6M8 2l-6 6" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/**
 * Windows frameless caption buttons (Serpent-znex).
 * Lives outside App.tsx to keep the shell chrome modular (acceptance #8).
 */
export function WindowsWindowControls({
  shell,
}: {
  shell: ShellBridge | undefined;
}): ReactElement | null {
  const t = useT();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!shell) return;
    let cancelled = false;
    void shell.windowControl("get-state").then((result) => {
      if (!cancelled && result.ok) setMaximized(result.maximized);
    });
    const unsubscribe = shell.onWindowMaximizedChanged((next) => {
      if (!cancelled) setMaximized(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [shell]);

  if (!shell) return null;

  const run = (action: WindowControlAction): void => {
    void shell.windowControl(action).then((result) => {
      if (result.ok && action === "maximize-toggle") {
        setMaximized(result.maximized);
      }
    });
  };

  return (
    <div
      aria-label={t("shell.windowControls")}
      className="windows-window-controls"
      role="group"
    >
      <button
        aria-label={t("shell.windowMinimize")}
        className="windows-caption-button"
        data-hover-tip={t("shell.windowMinimize")}
        onClick={() => run("minimize")}
        type="button"
      >
        <CaptionIcon kind="minimize" />
      </button>
      <button
        aria-label={
          maximized ? t("shell.windowRestore") : t("shell.windowMaximize")
        }
        className="windows-caption-button"
        data-hover-tip={
          maximized ? t("shell.windowRestore") : t("shell.windowMaximize")
        }
        onClick={() => run("maximize-toggle")}
        type="button"
      >
        <CaptionIcon kind={maximized ? "restore" : "maximize"} />
      </button>
      <button
        aria-label={t("shell.windowClose")}
        className="windows-caption-button windows-caption-button-close"
        data-hover-tip={t("shell.windowClose")}
        onClick={() => run("close")}
        type="button"
      >
        <CaptionIcon kind="close" />
      </button>
    </div>
  );
}
