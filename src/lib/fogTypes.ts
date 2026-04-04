export interface FogPoint {
  x: number; // normalized 0-1
  y: number; // normalized 0-1
}

export interface FogStroke {
  type: "reveal" | "hide";
  points: FogPoint[];
  radius: number; // normalized 0-1 (relative to canvas width)
}

export interface FogState {
  enabled: boolean;
  strokes: FogStroke[];
}

export const INITIAL_FOG_STATE: FogState = {
  enabled: false,
  strokes: [],
};

/** Render fog onto a canvas element. */
export function renderFog(
  canvas: HTMLCanvasElement,
  state: FogState,
  width: number,
  height: number
) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (!state.enabled) {
    ctx.clearRect(0, 0, width, height);
    return;
  }

  // Fill with fog
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.92)";
  ctx.fillRect(0, 0, width, height);

  // Apply strokes in order
  for (const stroke of state.strokes) {
    const r = stroke.radius * width;
    if (stroke.type === "reveal") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0, 0, 0, 0.92)";
    }

    for (let i = 0; i < stroke.points.length; i++) {
      const pt = stroke.points[i];
      const px = pt.x * width;
      const py = pt.y * height;

      if (i === 0) {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Draw filled capsule between consecutive points for smooth stroke
        const prev = stroke.points[i - 1];
        const ppx = prev.x * width;
        const ppy = prev.y * height;
        const dx = px - ppx;
        const dy = py - ppy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) continue;

        // Fill circles along the path
        const steps = Math.ceil(dist / (r * 0.5));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const ix = ppx + dx * t;
          const iy = ppy + dy * t;
          ctx.beginPath();
          ctx.arc(ix, iy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  ctx.globalCompositeOperation = "source-over";
}
