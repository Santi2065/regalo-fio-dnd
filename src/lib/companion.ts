import { invoke } from "@tauri-apps/api/core";

export interface Character {
  id: string;
  name: string;
}

export interface CompanionInfo {
  url: string;
  local_ip: string;
  port: number;
  pin: string | null;
  qr_svg: string;
}

export interface ConnectedPlayer {
  token: string;
  character: Character;
  connected_seconds_ago: number;
}

export interface CompanionStatus {
  running: boolean;
  info: CompanionInfo | null;
  characters: Character[];
  connected: ConnectedPlayer[];
}

export const companionStart = (
  pin: string | null,
  campaignName: string | null,
  characters: Character[] | null
) =>
  invoke<CompanionInfo>("companion_start", {
    pin,
    campaignName,
    characters,
  });

export const companionStop = () => invoke<void>("companion_stop");

export const companionStatus = () => invoke<CompanionStatus>("companion_status");

export const companionGeneratePin = () => invoke<string>("companion_generate_pin");

export const companionSetCharacters = (characters: Character[]) =>
  invoke<void>("companion_set_characters", { characters });

export const companionKickPlayer = (token: string) =>
  invoke<void>("companion_kick_player", { token });

export const companionSendHandout = (
  toToken: string | null,
  title: string | null,
  body: string
) =>
  invoke<void>("companion_send_handout", {
    toToken,
    title,
    body,
  });
