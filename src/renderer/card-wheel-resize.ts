import { nextDiscreteCardSizeFromWheelDelta } from "./card-size-stops";

/** Count every wheel notch, but capture/reflow only once per displayed frame. */
export class CardWheelResize {
  private frame: number | null = null;
  private pending: { size: number; x: number; y: number } | null = null;
  private stops: readonly number[] | null = null;

  constructor(
    private readonly currentSize: () => number,
    private readonly readStops: () => readonly number[],
    private readonly apply: (size: number, x: number, y: number) => void,
  ) {}

  enqueue(delta: number, x: number, y: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    this.stops ??= this.readStops();
    const current = this.pending?.size ?? this.currentSize();
    const size = nextDiscreteCardSizeFromWheelDelta(current, delta, this.stops);
    this.pending = { size, x, y };
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      const pending = this.pending;
      this.pending = null;
      this.stops = null;
      if (pending && pending.size !== this.currentSize()) this.apply(pending.size, pending.x, pending.y);
    });
  }

  cancel(): void {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending = null;
    this.stops = null;
  }
}
