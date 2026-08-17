// REQ-FILTER-021: dimension buttons toggle that dimension's filter on/off
// without discarding the user's configured criteria; hovering the button
// opens its settings popover independently of this click toggle (wired in
// DimensionFilterBar's hover handlers). Turning a dimension off clears its
// live filter value so it stops affecting query results, while remembering
// the prior value; turning it back on restores exactly what was remembered.
// Toggling a dimension that currently has nothing configured (and nothing
// remembered) is a no-op.
//
// Plain class rather than a hook: each DimensionFilterBar dimension owns one
// instance (held in a useRef) so the remembered value survives re-renders
// without extra state plumbing, and the memory logic is trivially unit
// testable without React.
export class DimensionEnableToggle<T> {
  private remembered: T | null = null;

  toggle(
    active: boolean,
    current: T,
    cleared: T,
    apply: (value: T) => void,
  ): void {
    if (active) {
      this.remembered = current;
      apply(cleared);
      return;
    }
    const remembered = this.remembered;
    if (remembered === null) return;
    this.remembered = null;
    apply(remembered);
  }
}
