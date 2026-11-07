import type { SearchExpressionNode } from "../shared/asset-types";
import { parseSearchExpressionDetailed } from "../shared/search-expression";

/** Small source-preserving edits for the single tag-expression input. */
export function escapeTagExpressionName(name: string): string {
  return `"${name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function tagExpressionTermAt(source: string, caret: number): { start: number; end: number; value: string } | null {
  const pos = Math.max(0, Math.min(caret, source.length));
  let i = 0;
  while (i < source.length) {
    if (/\s|[|()]/u.test(source[i]!)) { i += 1; continue; }
    const start = i;
    let quoted = false;
    let escaped = false;
    let wordParenDepth = 0;
    let hasWord = false;
    while (i < source.length) {
      const ch = source[i]!;
      if (escaped) { escaped = false; hasWord = true; i += 1; continue; }
      if (quoted && ch === "\\") { escaped = true; i += 1; continue; }
      if (ch === '"') { quoted = !quoted; hasWord = true; i += 1; continue; }
      if (!quoted && (/[\s|]/u.test(ch))) break;
      if (!quoted && ch === "(" && !hasWord) break;
      if (!quoted && ch === "(") wordParenDepth += 1;
      if (!quoted && ch === ")" && wordParenDepth === 0) break;
      if (!quoted && ch === ")" && wordParenDepth > 0) wordParenDepth -= 1;
      hasWord = true;
      i += 1;
    }
    const end = i;
    if (hasWord && start <= pos && pos <= end) {
      let raw = source.slice(start, end).replace(/^-+/u, "").replace(/^(?:tag[:=])/iu, "");
      if (start > 0 && source[start - 1] === "-") raw = raw.replace(/^-/u, "");
      const value = raw.replace(/^"|"$/gu, "").replace(/\\([\\"])/gu, "$1");
      return { start, end, value };
    }
    if (i === start) i += 1;
  }
  return null;
}

export function replaceTagExpressionTerm(
  source: string,
  caret: number,
  name: string,
  side: "include" | "exclude",
  shiftKey = false,
): { value: string; caret: number } {
  const token = tagExpressionTermAt(source, caret);
  const replacement = `${side === "exclude" ? "-" : ""}${escapeTagExpressionName(name)}`;
  if (shiftKey && side === "include") {
    const parsed = parseSearchExpressionDetailed(source, "tags");
    const exact = (node: SearchExpressionNode): string | null => node.kind === "TERM"
      && node.field === "tags" && node.match === "exact_tag" ? node.value : null;
    const root = parsed.ok ? parsed.expression.root : null;
    const children = root?.kind === "AND" ? root.children : root ? [root] : [];
    const includes: string[] = [];
    const excludes: string[] = [];
    let safe = parsed.ok;
    for (const child of children) {
      const direct = exact(child);
      if (direct !== null) { includes.push(direct); continue; }
      if (child.kind === "OR" && child.children.every((item) => exact(item) !== null)) {
        includes.push(...child.children.map((item) => exact(item)!));
        continue;
      }
      if (child.kind === "NOT" && exact(child.child) !== null) {
        excludes.push(exact(child.child)!);
        continue;
      }
      safe = false;
      break;
    }
    if (safe) {
      includes.push(name);
      const uniqueIncludes = [...new Set(includes)];
      const positive = uniqueIncludes.length > 1
        ? [`(${uniqueIncludes.map(escapeTagExpressionName).join(" | ")})`]
        : uniqueIncludes.map(escapeTagExpressionName);
      const value = [...positive, ...excludes.map((item) => `-${escapeTagExpressionName(item)}`)].join(" ") + " ";
      return { value, caret: value.length };
    }
    // An OR over an arbitrary formula could change the scope of existing
    // exclusions. Preserve the current formula with a safe AND addition.
    const value = source.trim() ? `${source.trimEnd()} ${escapeTagExpressionName(name)} ` : `${escapeTagExpressionName(name)} `;
    return { value, caret: value.length };
  }
  if (shiftKey && side === "exclude") {
    const insertion = `-${escapeTagExpressionName(name)}`;
    const value = source.trim() ? `${source.trimEnd()} ${insertion}` : insertion;
    return { value, caret: value.length };
  }
  if (token) {
    const suffix = token.end === source.length ? " " : "";
    const value = `${source.slice(0, token.start)}${replacement}${suffix}${source.slice(token.end)}`;
    return { value, caret: token.start + replacement.length + suffix.length };
  }
  const before = source.slice(0, caret);
  const after = source.slice(caret);
  const prefix = before.length > 0 && !/\s$/u.test(before) ? " " : "";
  const suffix = after.length > 0 && !/^\s/u.test(after) ? " " : after.length === 0 ? " " : "";
  const insertion = `${prefix}${replacement}${suffix}`;
  return { value: `${before}${insertion}${after}`, caret: before.length + prefix.length + replacement.length + suffix.length };
}

