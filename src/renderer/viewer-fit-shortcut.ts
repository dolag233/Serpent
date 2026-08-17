/** Viewer-wide keyboard gesture for returning media to contain-fit. */
export function isViewerFitShortcut(event: {
  code?: string;
  key: string;
  location?: number;
}): boolean {
  return (
    event.code === "NumpadDecimal" ||
    event.code === "Decimal" ||
    event.key === "Decimal" ||
    event.key === "NumpadDecimal" ||
    (event.key === "." && event.location === 3)
  );
}
