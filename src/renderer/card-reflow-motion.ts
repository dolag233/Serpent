const movingCards = new WeakMap<HTMLElement, Animation>();

/** Scroll anchoring must measure layout, not the temporary visual FLIP offset. */
export function cardReflowLayoutRect(card: HTMLElement): DOMRect {
  const rect = card.getBoundingClientRect();
  if (!movingCards.has(card)) return rect;
  const style = getComputedStyle(card);
  const translation = style.translate.split(/\s+/).map(Number.parseFloat);
  const scaling = style.scale.split(/\s+/).map(Number.parseFloat);
  const x = Number.isFinite(translation[0]) ? translation[0]! : 0;
  const y = Number.isFinite(translation[1]) ? translation[1]! : 0;
  const sx = scaling[0] && Number.isFinite(scaling[0]) ? scaling[0] : 1;
  const sy = scaling[1] && Number.isFinite(scaling[1]) ? scaling[1] : sx;
  return new DOMRect(rect.left - x, rect.top - y, rect.width / sx, rect.height / sy);
}

/** Animate mounted cards by identity, including cards moved between virtual columns. */
export class CardReflowMotion {
  private before = new Map<string, DOMRect>();
  private running = new Map<HTMLElement, Animation>();

  private cards(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(".asset-card[data-asset-id], .folder-card[data-folder-id]")];
  }

  private key(card: HTMLElement): string {
    return card.dataset.assetId ? `asset:${card.dataset.assetId}` : `folder:${card.dataset.folderId}`;
  }

  capture(root: HTMLElement): void {
    const viewport = root.getBoundingClientRect();
    const next = new Map<string, DOMRect>();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const card of this.cards(root)) {
        // Read the current animated position before cancelling a prior gesture.
        const rect = card.getBoundingClientRect();
        if (rect.bottom > viewport.top && rect.top < viewport.bottom &&
            rect.right > viewport.left && rect.left < viewport.right) {
          next.set(this.key(card), rect);
        }
      }
    }
    this.cancel();
    this.before = next;
  }

  play(root: HTMLElement): void {
    const before = this.before;
    this.before = new Map();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Batch geometry reads before starting animations. Offscreen assets and new
    // virtual slots have no old position and must not fly in from the origin.
    const moves = this.cards(root).flatMap((card) => {
      const from = before.get(this.key(card));
      if (!from || typeof card.animate !== "function") return [];
      const to = cardReflowLayoutRect(card);
      if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return [];
      if (Math.abs(from.left - to.left) < 0.5 && Math.abs(from.top - to.top) < 0.5 &&
          Math.abs(from.width - to.width) < 0.5 && Math.abs(from.height - to.height) < 0.5) return [];
      return [{ card, from, to }];
    });
    for (const { card, from, to } of moves) {
      const animation = card.animate([
        { translate: `${from.left - to.left}px ${from.top - to.top}px`,
          scale: `${from.width / to.width} ${from.height / to.height}`, transformOrigin: "0 0" },
        { translate: "0px 0px", scale: "1 1", transformOrigin: "0 0" },
      ], { duration: 200, easing: "cubic-bezier(0.2, 0, 0.2, 1)" });
      this.running.set(card, animation);
      movingCards.set(card, animation);
      const finished = () => {
        if (this.running.get(card) === animation) this.running.delete(card);
        if (movingCards.get(card) === animation) movingCards.delete(card);
      };
      void animation.finished.then(finished, finished);
    }
  }

  cancel(): void {
    for (const [card, animation] of this.running) {
      if (movingCards.get(card) === animation) movingCards.delete(card);
      animation.cancel();
    }
    this.running.clear();
    this.before.clear();
  }
}
