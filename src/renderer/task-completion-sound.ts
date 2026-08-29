import completionSoundUrl from "./assets/complete-sfx.mp3";
import { loadTaskCompletionSoundPreferences } from "./task-completion-sound-preferences";

/** Keep the completion cue audible without competing with the user's work. */
export const TASK_COMPLETION_SOUND_VOLUME = 0.18;
/** A result cue is reserved for operations that have lasted longer than a minute. */
export const TASK_COMPLETION_SOUND_MIN_DURATION_MS = 60_000;

export type CompletionAudio = {
  currentTime: number;
  volume: number;
  play(): Promise<void> | void;
};

export type CompletionAudioFactory = (source: string) => CompletionAudio;
export type CompletionSoundEnabled = () => boolean;

export function shouldPlayTaskCompletionSound(
  startedAt: number,
  finishedAt = Date.now(),
): boolean {
  return (
    Number.isFinite(startedAt) &&
    Number.isFinite(finishedAt) &&
    finishedAt - startedAt > TASK_COMPLETION_SOUND_MIN_DURATION_MS
  );
}

export function createTaskCompletionSound(
  createAudio: CompletionAudioFactory = (source) => new Audio(source),
  isEnabled: CompletionSoundEnabled = () =>
    loadTaskCompletionSoundPreferences().enabled,
): () => void {
  let audio: CompletionAudio | undefined;
  return () => {
    try {
      if (!isEnabled()) return;
      audio ??= createAudio(completionSoundUrl);
      audio.volume = TASK_COMPLETION_SOUND_VOLUME;
      audio.currentTime = 0;
      void Promise.resolve(audio.play()).catch(() => {
        // A platform may reject playback before the first user gesture. The
        // task result is already visible, so a blocked cue must stay silent.
      });
    } catch {
      // Audio is an optional affordance and must never affect the operation.
    }
  };
}

const playTaskCompletionSoundImmediately = createTaskCompletionSound();

/** Play only for an eligible operation that actually exceeded one minute. */
export function playTaskCompletionSound(
  startedAt: number,
  finishedAt = Date.now(),
): void {
  if (!shouldPlayTaskCompletionSound(startedAt, finishedAt)) return;
  playTaskCompletionSoundImmediately();
}
