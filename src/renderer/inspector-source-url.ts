/**
 * Validate Inspector source URL for save (trim + http(s) + no credentials).
 * Pure helper — Main still re-validates before shell.openExternal.
 */

export function isValidInspectorSourceUrl(value: string): boolean {
  if (value === "") return true;
  try {
    const parsed = new URL(value);
    return (
      value === value.trim() &&
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}
