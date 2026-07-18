/**
 * Pure helpers for text asset detection (Serpent-sh7).
 */

export const TEXT_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".tsv",
  ".log",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".css",
  ".html",
  ".htm",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".sh",
  ".bat",
  ".ps1",
  ".sql",
] as const;

export const TEXT_MIME_BY_EXTENSION: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".log": "text/plain",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "application/toml",
  ".ini": "text/plain",
  ".cfg": "text/plain",
  ".conf": "text/plain",
  ".css": "text/css",
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "text/javascript",
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".jsx": "text/javascript",
  ".py": "text/x-python",
  ".rs": "text/plain",
  ".go": "text/plain",
  ".sh": "text/x-shellscript",
  ".bat": "text/plain",
  ".ps1": "text/plain",
  ".sql": "application/sql",
};

/** Soft caps for Worker text IPC (bytes, UTF-8). */
export const TEXT_PREVIEW_MAX_BYTES = 16 * 1024;
export const TEXT_VIEWER_MAX_BYTES = 1024 * 1024;
export const TEXT_SAVE_MAX_BYTES = 1024 * 1024;

export function isTextFileName(filenameOrMime: string): boolean {
  const lower = filenameOrMime.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function textMimeForExtension(extension: string): string | null {
  return TEXT_MIME_BY_EXTENSION[extension.toLowerCase()] ?? null;
}

/** Count newline-separated lines; trailing newline still counts as a final empty line only if content ends with \\n after non-empty. */
export function countTextLines(content: string): number {
  if (content.length === 0) return 1;
  let lines = 1;
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) lines += 1;
  }
  return lines;
}
