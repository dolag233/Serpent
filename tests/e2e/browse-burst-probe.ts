import { expect, type Page } from "@playwright/test";
import { visibleImageStats } from "./perf-bench-helpers";

const BURST_FRACTIONS = [0.12, 0.31, 0.62, 0.43, 0.73, 0.92, 0.17, 0.67] as const;

/** Cold destinations spaced beyond the ordinary lookahead window. */
export async function probeBrowseBurst(window: Page) {
  const canvas = window.locator(".workspace-canvas");
  const startedEpochMs = Date.now();
  let finalJumpAt = startedEpochMs;
  for (const [index, fraction] of BURST_FRACTIONS.entries()) {
    if (index === BURST_FRACTIONS.length - 1) finalJumpAt = Date.now();
    await canvas.evaluate((element, ratio) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * ratio;
    }, fraction);
    if (index < BURST_FRACTIONS.length - 1) await window.waitForTimeout(100);
  }
  let firstDecodedMs: number | null = null;
  let mostlyDecodedMs: number | null = null;
  while (Date.now() - finalJumpAt < 3000) {
    const images = await visibleImageStats(window);
    if (images.decodedImages > 0 && firstDecodedMs === null) firstDecodedMs = Date.now() - finalJumpAt;
    if (images.imageCards > 0 && images.coverage >= 0.9 && mostlyDecodedMs === null) {
      mostlyDecodedMs = Date.now() - finalJumpAt;
    }
    await window.waitForTimeout(40);
  }
  const images = await visibleImageStats(window);
  const actualFraction = await canvas.evaluate(element =>
    element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight));
  expect(Math.abs(actualFraction - BURST_FRACTIONS.at(-1)!)).toBeLessThan(0.01);
  expect(images.decodedImages).toBeGreaterThan(0);
  expect(images.coverage).toBeGreaterThanOrEqual(0.9);
  expect(mostlyDecodedMs).not.toBeNull();
  return { startedEpochMs, observedMs: Date.now() - startedEpochMs,
    steps: BURST_FRACTIONS.length, finalJumpOffsetMs: finalJumpAt - startedEpochMs,
    firstDecodedMs, mostlyDecodedMs, actualFraction, images };
}
