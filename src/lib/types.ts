export interface Session {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  session_id: string | null;
  name: string;
  file_path: string;
  asset_type: "image" | "audio" | "document" | "video" | "map" | "character_sheet";
  thumbnail_path: string | null;
  tags: string[];
  created_at: string;
}

export interface Note {
  id: string;
  session_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export type AssetType = Asset["asset_type"] | "all";
