import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/**
 * Centralized audio controller.
 *
 * Wraps the Tauri commands (play_sfx / play_ambient / stop_ambient /
 * stop_all_audio) and tracks which named loop "channels" are active so any
 * component can subscribe and stay visually in sync — e.g. if a loop is
 * started from the script editor, the soundboard cell that uses the same
 * audio reflects it without polling.
 */

interface AudioStore {
  activeLoops: Set<string>;
  start: (channel: string) => void;
  stop: (channel: string) => void;
  clear: () => void;
}

const useAudioStore = create<AudioStore>((set) => ({
  activeLoops: new Set<string>(),
  start: (channel) =>
    set((s) => {
      if (s.activeLoops.has(channel)) return s;
      const next = new Set(s.activeLoops);
      next.add(channel);
      return { activeLoops: next };
    }),
  stop: (channel) =>
    set((s) => {
      if (!s.activeLoops.has(channel)) return s;
      const next = new Set(s.activeLoops);
      next.delete(channel);
      return { activeLoops: next };
    }),
  clear: () =>
    set((s) => (s.activeLoops.size === 0 ? s : { activeLoops: new Set<string>() })),
}));

/** Fire a one-shot SFX. */
export async function playOneShot(filePath: string, volume = 1.0): Promise<void> {
  await invoke("play_sfx", { filePath, volume });
}

/** Start a named looping channel. */
export async function startLoop(
  channel: string,
  filePath: string,
  volume = 1.0
): Promise<void> {
  await invoke("play_ambient", { channel, filePath, volume });
  useAudioStore.getState().start(channel);
}

/** Stop a named looping channel. */
export async function stopLoop(channel: string): Promise<void> {
  await invoke("stop_ambient", { channel });
  useAudioStore.getState().stop(channel);
}

/**
 * Toggle a named looping channel. Returns true if the loop is now active,
 * false if it was just stopped.
 */
export async function toggleLoop(
  channel: string,
  filePath: string,
  volume = 1.0
): Promise<boolean> {
  const isActive = useAudioStore.getState().activeLoops.has(channel);
  if (isActive) {
    await stopLoop(channel);
    return false;
  }
  await startLoop(channel, filePath, volume);
  return true;
}

/** Stop all SFX and loops; clears the active-loops store. */
export async function stopAllAudio(): Promise<void> {
  await invoke("stop_all_audio");
  useAudioStore.getState().clear();
}

/** React hook: subscribe to the full set of active loop channels. */
export function useActiveLoops(): Set<string> {
  return useAudioStore((s) => s.activeLoops);
}

/** React hook: subscribe to whether a single channel is active. */
export function useIsLoopActive(channel: string): boolean {
  return useAudioStore((s) => s.activeLoops.has(channel));
}

/**
 * Channel name builders — keep these in one place so different surfaces
 * (script cues, soundboard cells, quick sounds) can detect overlap.
 */
export const channels = {
  /** Channel for an asset triggered as ambient from the script. */
  scriptAmbient: (assetId: string) => `ambient-${assetId}`,
  /** Channel for the live-mode quick soundboard list. */
  quickAmbient: (assetId: string) => `quick-${assetId}`,
  /** Channel for a soundboard slot in the inspector tab. */
  soundboardSlot: (slotId: string) => `ambient-${slotId}`,
};
