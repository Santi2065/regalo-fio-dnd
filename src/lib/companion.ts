import { invoke } from "@tauri-apps/api/core";

export interface CompanionInfo {
  url: string;
  local_ip: string;
  port: number;
  pin: string | null;
  qr_svg: string;
}

export interface CompanionStatus {
  running: boolean;
  info: CompanionInfo | null;
  connected_players: number;
}

export const companionStart = (pin: string | null, campaignName: string | null) =>
  invoke<CompanionInfo>("companion_start", { pin, campaignName });

export const companionStop = () => invoke<void>("companion_stop");

export const companionStatus = () => invoke<CompanionStatus>("companion_status");

export const companionGeneratePin = () => invoke<string>("companion_generate_pin");
