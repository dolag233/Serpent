/**
 * Trading-card style pointer tilt (experiment/card-feel-preview).
 * Pure math + DOM class/CSS vars — no React re-renders per move.
 *
 * Specular uses a point light above the pointer (explicit Z), not a 2D
 * pointer-follow hotspot — the latter reads as anisotropic swirl.
 */

export const INSPECTOR_CARD_FEEL_TILT_SELECTOR =
  ".inspector-pane [data-card-feel-tilt]";

export const CARD_FEEL_MAX_TILT_X = 3.5;
export const CARD_FEEL_MAX_TILT_Y = 4.9;

/**
 * Point-light height in half-card units (card spans ≈ [-1,1]²).
 * Larger → softer / more centered; smaller → tighter under the finger.
 */
export const CARD_FEEL_LIGHT_Z = 1.12;

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

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Specular hotspot for a point light above the pointer on a tilted card.
 * Light at ((px-0.5)*2, (py-0.5)*2, lightZ); camera along +Z.
 */
export function cardFeelSpecularHighlight(
  pointerX: number,
  pointerY: number,
  rotateXDeg: number,
  rotateYDeg: number,
  lightZ = CARD_FEEL_LIGHT_Z,
): { glareX: number; glareY: number } {
  const px = Math.min(1, Math.max(0, pointerX));
  const py = Math.min(1, Math.max(0, pointerY));
  const lx = (px - 0.5) * 2;
  const ly = (py - 0.5) * 2;
  const lz = Math.max(lightZ, 0.25);

  // CSS applies right-to-left: `rotateX() rotateY()` → rotateY then rotateX.
  // N0=(0,0,1) → after rotateY(ry), rotateX(rx):
  const rx = degToRad(rotateXDeg);
  const ry = degToRad(rotateYDeg);
  const nx = Math.sin(ry);
  const ny = -Math.cos(ry) * Math.sin(rx);
  // nz unused for planar UV slide; kept for documentation of the frame.
  void (Math.cos(ry) * Math.cos(rx));

  // Footprint of the light on the card, then slide toward the raised face
  // (normal XY). Division by lz is the “point light height” term — too-small
  // Z over-slides and reads like a spinning anisotropic brush.
  const lift = 0.42 / lz;
  const u = Math.max(-1, Math.min(1, lx + nx * lift));
  const v = Math.max(-1, Math.min(1, ly + ny * lift));

  return {
    glareX: (u * 0.5 + 0.5) * 100,
    glareY: (v * 0.5 + 0.5) * 100,
  };
}

/**
 * Map pointer → tilt so the near edge follows the cursor
 * (left/top of card tip toward the viewer when the pointer is there).
 */
export function cardFeelTiltFromPointer(
  rect: CardFeelTiltRect,
  clientX: number,
  clientY: number,
  lightZ = CARD_FEEL_LIGHT_Z,
): CardFeelTiltPose {
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  const px = Math.min(1, Math.max(0, (clientX - rect.left) / width));
  const py = Math.min(1, Math.max(0, (clientY - rect.top) / height));
  const rotateX = (py - 0.5) * CARD_FEEL_MAX_TILT_X * 2;
  const rotateY = (0.5 - px) * CARD_FEEL_MAX_TILT_Y * 2;
  const specular = cardFeelSpecularHighlight(px, py, rotateX, rotateY, lightZ);
  return {
    rotateX,
    rotateY,
    glareX: specular.glareX,
    glareY: specular.glareY,
  };
}

/** Capture layout box before any tilt transform is applied. */
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
