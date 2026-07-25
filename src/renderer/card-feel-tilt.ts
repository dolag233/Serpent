/**
 * Trading-card style pointer tilt (experiment/card-feel-preview).
 * Pure math + DOM class/CSS vars — no React re-renders per move.
 */

export const INSPECTOR_CARD_FEEL_TILT_SELECTOR =
  ".inspector-pane [data-card-feel-tilt]";

export const CARD_FEEL_MAX_TILT_X = 5;
export const CARD_FEEL_MAX_TILT_Y = 7;

export type CardFeelTiltRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type CardFeelTiltPose = {
  readonly rotateX: number;
  readonly rotateY: number;
  readonly glareX: number;
  readonly glareY: number;
};

export function cardFeelTiltFromPointer(
  rect: CardFeelTiltRect,
  clientX: number,
  clientY: number,
): CardFeelTiltPose {
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  const px = Math.min(1, Math.max(0, (clientX - rect.left) / width));
  const py = Math.min(1, Math.max(0, (clientY - rect.top) / height));
  return {
    rotateX: (py - 0.5) * CARD_FEEL_MAX_TILT_X * 2,
    rotateY: (0.5 - px) * CARD_FEEL_MAX_TILT_Y * 2,
    glareX: px * 100,
    glareY: py * 100,
  };
}

export function captureCardFeelTiltRect(element: HTMLElement): CardFeelTiltRect {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function applyCardFeelTilt(
  element: HTMLElement,
  clientX: number,
  clientY: number,
  layoutRect: CardFeelTiltRect,
): void {
  const pose = cardFeelTiltFromPointer(layoutRect, clientX, clientY);
  element.style.setProperty("--card-tilt-x", `${pose.rotateX.toFixed(2)}deg`);
  element.style.setProperty("--card-tilt-y", `${pose.rotateY.toFixed(2)}deg`);
  element.style.setProperty("--card-glare-x", `${pose.glareX.toFixed(1)}%`);
  element.style.setProperty("--card-glare-y", `${pose.glareY.toFixed(1)}%`);
  element.style.setProperty(
    "--card-shadow-x",
    `${((pose.rotateY / CARD_FEEL_MAX_TILT_Y) * 6).toFixed(1)}px`,
  );
  element.style.setProperty(
    "--card-shadow-y",
    `${((-pose.rotateX / CARD_FEEL_MAX_TILT_X) * 7 + 6).toFixed(1)}px`,
  );
  element.classList.add("is-card-tilting");
}

export function resetCardFeelTilt(element: HTMLElement): void {
  element.style.removeProperty("--card-tilt-x");
  element.style.removeProperty("--card-tilt-y");
  element.style.removeProperty("--card-glare-x");
  element.style.removeProperty("--card-glare-y");
  element.style.removeProperty("--card-shadow-x");
  element.style.removeProperty("--card-shadow-y");
  element.classList.remove("is-card-tilting");
  element.classList.remove("is-card-pressing");
}

export function setCardFeelPressing(
  element: HTMLElement,
  pressing: boolean,
): void {
  element.classList.toggle("is-card-pressing", pressing);
}
