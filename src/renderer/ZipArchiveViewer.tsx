import { useEffect, useState } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import { formatBytes } from "./format-file-meta";
import { useT } from "./i18n";

type ZipFileEntry = {
  index: number;
  name: string;
  uncompressedSize: number;
};

type ZipEntryPreview = {
  index: number;
  name: string;
  kind: "image" | "text" | "unavailable";
  mimeType?: string;
  bytesBase64?: string;
  text?: string;
  truncated?: boolean;
};

export function ZipArchiveViewer({
  api,
  libraryId,
  assetId,
  fallbackSrc,
  onPresentationReady,
}: {
  api: SerpentLibraryApi;
  libraryId: string;
  assetId: string;
  fallbackSrc: string | null;
  onPresentationReady?: () => void;
}) {
  const t = useT();
  const [status, setStatus] = useState<"loading" | "ready" | "unreadable">("loading");
  const [truncated, setTruncated] = useState(false);
  const [files, setFiles] = useState<ZipFileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [entry, setEntry] = useState<ZipEntryPreview | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setFiles([]);
    setSelectedIndex(null);
    setEntry(null);
    void api.listZipEntries({ libraryId, assetId }).then((result) => {
      if (cancelled) return;
      if (!result.ok || result.value.status !== "ready") {
        setStatus("unreadable");
      } else {
        setFiles(result.value.files);
        setTruncated(result.value.truncated);
        setStatus("ready");
      }
      onPresentationReady?.();
    }).catch(() => {
      if (cancelled) return;
      setStatus("unreadable");
      onPresentationReady?.();
    });
    return () => {
      cancelled = true;
    };
  }, [api, assetId, libraryId, onPresentationReady]);

  useEffect(() => {
    if (entry?.kind !== "image" || !entry.bytesBase64) {
      setObjectUrl(null);
      return;
    }
    const binary = atob(entry.bytesBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const url = URL.createObjectURL(new Blob([bytes], {
      type: entry.mimeType ?? "application/octet-stream",
    }));
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [entry]);

  async function openEntry(file: ZipFileEntry): Promise<void> {
    setSelectedIndex(file.index);
    setEntryLoading(true);
    const result = await api.readZipEntry({ libraryId, assetId, index: file.index });
    setEntryLoading(false);
    if (!result.ok) {
      setEntry({ index: file.index, name: file.name, kind: "unavailable" });
      return;
    }
    setEntry({
      index: result.value.index,
      name: result.value.name,
      kind: result.value.kind,
      mimeType: result.value.mimeType,
      bytesBase64: result.value.bytesBase64,
      text: result.value.text,
      truncated: result.value.truncated,
    });
  }

  return (
    <div className="zip-archive-viewer">
      <div className="zip-archive-list" role="listbox" aria-label={t("preview.zipFiles")}>
        {status === "loading" ? (
          <p className="zip-archive-note">{t("preview.zipLoading")}</p>
        ) : status === "unreadable" ? (
          <p className="zip-archive-note">{t("preview.zipUnreadable")}</p>
        ) : files.length === 0 ? (
          <p className="zip-archive-note">{t("preview.zipEmpty")}</p>
        ) : (
          files.map((file) => (
            <button
              aria-selected={file.index === selectedIndex}
              className="zip-archive-file"
              key={`${file.index}:${file.name}`}
              onClick={() => void openEntry(file)}
              role="option"
              type="button"
            >
              <span className="zip-archive-file-name">{file.name}</span>
              <span className="zip-archive-file-size">{formatBytes(file.uncompressedSize)}</span>
            </button>
          ))
        )}
        {truncated ? <p className="zip-archive-note">{t("preview.zipTruncated")}</p> : null}
      </div>
      <div className="zip-archive-preview">
        {entryLoading ? (
          <p className="zip-archive-note">{t("preview.zipLoading")}</p>
        ) : entry?.kind === "image" && objectUrl ? (
          <img alt={entry.name} src={objectUrl} />
        ) : entry?.kind === "text" && entry.text !== undefined ? (
          <pre>
            {entry.text}
            {entry.truncated ? `\n\n${t("preview.zipTextTruncated")}` : ""}
          </pre>
        ) : entry?.kind === "unavailable" ? (
          <p className="zip-archive-note">{t("preview.zipUnavailable")}</p>
        ) : fallbackSrc ? (
          <img alt="" src={fallbackSrc} />
        ) : (
          <p className="zip-archive-note">{t("preview.zipEmptyPreview")}</p>
        )}
      </div>
    </div>
  );
}
