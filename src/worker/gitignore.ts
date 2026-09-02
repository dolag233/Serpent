import ignore from "ignore";

/** The two path kinds that are materialized from a library ignore file. */
export type GitIgnorePathKind = "asset" | "folder";

type IgnoreMatcher = ReturnType<typeof ignore>;

/**
 * A compiled ignore file.  The matcher is deliberately kept behind this
 * module so callers cannot accidentally apply directory rules to file paths
 * without supplying the path kind.
 */
export type GitIgnoreMatcher = {
  readonly matcher: IgnoreMatcher;
};

/**
 * Compile the contents of a .serpentignore file using the same glob grammar
 * as .gitignore.  Invalid individual lines are ignored, matching Git's
 * tolerant treatment of an unusable pattern without discarding the rest of
 * the user's configuration.
 */
export function parseGitignore(text: string): GitIgnoreMatcher {
  const matcher = ignore({ ignorecase: true });
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    try {
      matcher.add({ pattern: line, mark: String(index) });
    } catch {
      // Keep valid rules active when an unrelated line is malformed.
    }

    // Managed assets live below the library's `Assets/` directory, while
    // users naturally write rules relative to that directory (for example
    // `renders/**/*.png`).  Compile a qualified spelling for path rules so
    // the matcher can evaluate one canonical path and still retain Git's
    // ordered positive/negative semantics.  Basename rules (`*.png`, `.*/`)
    // already match at every depth and do not need a second spelling.
    const qualified = assetsQualifiedPattern(line);
    if (qualified === undefined) continue;
    try {
      matcher.add({ pattern: qualified, mark: String(index) });
    } catch {
      // The original line was handled above; an invalid qualified form must
      // not make an otherwise valid ignore file unusable.
    }
  }
  return { matcher };
}

function assetsQualifiedPattern(line: string): string | undefined {
  if (line.length === 0 || line.startsWith('#')) return undefined;

  const negative = line.startsWith('!') && !line.startsWith('\\!');
  const body = negative ? line.slice(1) : line;
  // A leading slash is rooted at the .serpentignore file's library root;
  // `Assets/` is already the explicit library-root spelling.
  if (body.startsWith('/') || body.startsWith('Assets/')) return undefined;
  if (!body.includes('/')) return undefined;
  return `${negative ? '!' : ''}Assets/${body}`;
}

function normalizeIgnorePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
}

function candidatePath(relativePath: string, pathKind: GitIgnorePathKind): string | undefined {
  const normalized = normalizeIgnorePath(relativePath);
  if (!normalized) return undefined;
  const root = `Assets/${normalized}`;
  return pathKind === "folder" ? `${root}/` : root;
}

/**
 * Match a path against the complete rule list while retaining Git's
 * last-matching-rule and negation semantics.  The matcher evaluates the
 * canonical library-root path (`Assets/<relative path>`); parseGitignore adds
 * qualified variants for path rules written relative to `Assets/`.
 */
export function gitignoreMatchesPath(
  compiled: GitIgnoreMatcher,
  relativePath: string,
  pathKind: GitIgnorePathKind,
): boolean {
  const candidate = candidatePath(relativePath, pathKind);
  return candidate === undefined ? false : compiled.matcher.ignores(candidate);
}
