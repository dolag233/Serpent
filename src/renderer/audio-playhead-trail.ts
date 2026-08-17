/**
 * Particle-style playhead trail for the audio viewer (Serpent-r8a).
 *
 * Emit samples at a fixed rate while playing; each sample stays at the ratio
 * where it was born and fades over a lifetime. Pause stops emission so the
 * trail dissipates; faster playbackRate moves the head farther between emits
 * → longer visible trail; slower → shorter.
 */

export interface TrailParticle {
  readonly id: number;
  /** 0..1 position along the waveform at emission time. */
  readonly ratio: number;
  readonly bornAtMs: number;
}

/** Emit cadence while playing (≈ Niagara-style continuous spawn). */
export const TRAIL_EMIT_INTERVAL_MS = 1000 / 28;

/** How long a particle remains visible after emission. */
export const TRAIL_LIFETIME_MS = 850;

export function shouldEmitTrailParticle(
  lastEmitAtMs: number | null,
  nowMs: number,
  playing: boolean,
  intervalMs = TRAIL_EMIT_INTERVAL_MS,
): boolean {
  if (!playing) return false;
  if (lastEmitAtMs === null) return true;
  return nowMs - lastEmitAtMs >= intervalMs;
}

export function pruneTrailParticles(
  particles: readonly TrailParticle[],
  nowMs: number,
  lifetimeMs = TRAIL_LIFETIME_MS,
): TrailParticle[] {
  return particles.filter(
    (particle) => nowMs - particle.bornAtMs < lifetimeMs,
  );
}

/** Opacity 1 → 0 over the particle lifetime. */
export function trailParticleOpacity(
  bornAtMs: number,
  nowMs: number,
  lifetimeMs = TRAIL_LIFETIME_MS,
): number {
  const age = nowMs - bornAtMs;
  if (age <= 0) return 0.75;
  if (age >= lifetimeMs) return 0;
  return 0.75 * (1 - age / lifetimeMs);
}

export function nextTrailParticleId(previousId: number): number {
  return previousId + 1;
}
