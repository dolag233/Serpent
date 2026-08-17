import { expect, test } from "vitest";

import {
  pruneTrailParticles,
  shouldEmitTrailParticle,
  trailParticleOpacity,
  TRAIL_LIFETIME_MS,
} from "../../src/renderer/audio-playhead-trail";

test("emits only while playing and after the emit interval", () => {
  expect(shouldEmitTrailParticle(null, 1000, false)).toBe(false);
  expect(shouldEmitTrailParticle(null, 1000, true)).toBe(true);
  expect(shouldEmitTrailParticle(1000, 1020, true)).toBe(false);
  expect(shouldEmitTrailParticle(1000, 1040, true)).toBe(true);
});

test("prunes particles past lifetime so pause dissipates the trail", () => {
  const particles = [
    { id: 1, ratio: 0.1, bornAtMs: 0 },
    { id: 2, ratio: 0.2, bornAtMs: 500 },
  ];
  expect(pruneTrailParticles(particles, TRAIL_LIFETIME_MS + 1)).toEqual([
    { id: 2, ratio: 0.2, bornAtMs: 500 },
  ]);
  expect(pruneTrailParticles(particles, TRAIL_LIFETIME_MS + 500)).toEqual([]);
});

test("particle opacity fades from birth to lifetime", () => {
  expect(trailParticleOpacity(0, 0)).toBeGreaterThan(0.5);
  expect(trailParticleOpacity(0, TRAIL_LIFETIME_MS / 2)).toBeCloseTo(0.375, 2);
  expect(trailParticleOpacity(0, TRAIL_LIFETIME_MS)).toBe(0);
});
