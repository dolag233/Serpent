/** Escape a value for use inside a CSS attribute selector (`[attr="…"]`). */
export function escapeCssAttrValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
