// Cue syntax embedded in the guión text:
//   %%sfx:ASSET_ID:LABEL%%       — one-shot sound effect
//   %%ambient:ASSET_ID:LABEL%%   — looping ambient track (toggleable)
//   %%project:ASSET_ID:LABEL%%   — project image/video to player display

export type CueType = "sfx" | "ambient" | "project";

export interface Cue {
  type: CueType;
  assetId: string;
  label: string;
  raw: string; // the original %%...%% token for replacement
}

export type Block =
  | { kind: "text"; content: string }
  | { kind: "cue"; cue: Cue };

const CUE_REGEX = /%%(\w+):([^:%]+):([^%]*)%%/g;

export function parseGuion(content: string): Block[] {
  const blocks: Block[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(CUE_REGEX)) {
    const [raw, type, assetId, label] = match;
    const start = match.index ?? 0;

    if (start > lastIndex) {
      blocks.push({ kind: "text", content: content.slice(lastIndex, start) });
    }

    if (type === "sfx" || type === "ambient" || type === "project") {
      blocks.push({
        kind: "cue",
        cue: { type: type as CueType, assetId, label, raw },
      });
    } else {
      // Unknown cue type — treat as text
      blocks.push({ kind: "text", content: raw });
    }

    lastIndex = start + raw.length;
  }

  if (lastIndex < content.length) {
    blocks.push({ kind: "text", content: content.slice(lastIndex) });
  }

  return blocks;
}

export function buildCueToken(type: CueType, assetId: string, label: string): string {
  return `%%${type}:${assetId}:${label}%%`;
}

export const CUE_META: Record<CueType, { icon: string; color: string; label: string }> = {
  sfx:     { icon: "🔊", color: "bg-blue-900/60 border-blue-700 text-blue-200",     label: "SFX"     },
  ambient: { icon: "🎵", color: "bg-green-900/60 border-green-700 text-green-200",  label: "Ambient" },
  project: { icon: "🖼",  color: "bg-purple-900/60 border-purple-700 text-purple-200", label: "Proyectar" },
};
