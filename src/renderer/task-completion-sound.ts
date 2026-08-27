import completionSoundUrl from "./assets/complete-sfx.mp3";

/** Keep the completion cue audible without competing with the user's work. */
export const TASK_COMPLETION_SOUND_VOLUME = 0.18;

export type CompletionAudio = {
  currentTime: number;
  volume: number;
  play(): Promise<void> | void;
};

export type CompletionAudioFactory = (source: string) => CompletionAudio;

export function createTaskCompletionSound(
  createAudio: CompletionAudioFactory = (source) => new Audio(source),
): () => void {
  let audio: CompletionAudio | undefined;
  return () => {
    try {
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

export const playTaskCompletionSound = createTaskCompletionSound();
