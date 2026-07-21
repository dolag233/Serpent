/**
 * Pure helpers for text asset detection (Serpent-sh7 / Serpent-4l7).
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
  ".rst",
  ".tex",
  ".vue",
  ".svelte",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".lua",
  ".r",
  ".plist",
] as const;

/** Format-filter token that expands to every TEXT_EXTENSIONS entry. */
export const FORMAT_TEXT_TOKEN = "text";

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
  ".rst": "text/x-rst",
  ".tex": "application/x-tex",
  ".vue": "text/plain",
  ".svelte": "text/plain",
  ".kt": "text/x-kotlin",
  ".swift": "text/x-swift",
  ".rb": "text/x-ruby",
  ".php": "application/x-httpd-php",
  ".java": "text/x-java-source",
  ".c": "text/x-c",
  ".cpp": "text/x-c",
  ".h": "text/x-c",
  ".hpp": "text/x-c",
  ".cs": "text/plain",
  ".lua": "text/x-lua",
  ".r": "text/plain",
  ".plist": "application/xml",
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

/**
 * Expand format-filter tokens for SQL. The special `text` token becomes every
 * known text/code extension (without a leading dot); other tokens pass through.
 */
export function expandFormatFilterTokens(tokens: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tokens) {
    const token = raw.trim().replace(/^\./, "").toLowerCase();
    if (!token) continue;
    if (token === FORMAT_TEXT_TOKEN) {
      for (const ext of TEXT_EXTENSIONS) {
        const bare = ext.slice(1);
        if (seen.has(bare)) continue;
        seen.add(bare);
        out.push(bare);
      }
      continue;
    }
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/** True when the free-text format field carries the unified text token. */
export function formatFilterHasTextToken(formatFilter: string): boolean {
  return formatFilter
    .split(",")
    .map((token) => token.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean)
    .includes(FORMAT_TEXT_TOKEN);
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
