import { useState } from "react";
import type { StatBlock } from "../../lib/manuals";
import ManualPageViewer from "../ManualPageViewer";

interface Props {
  statBlock: StatBlock;
}

/**
 * Render compacto del stat block dentro de la fila del combatiente.
 * El raw_text que viene del backend ya tiene saltos de línea preservados,
 * así que basta con render como `<pre>` con tipografía mono. Para el v1
 * no parseamos sub-secciones (Acciones, Eye Rays, etc.) — si la legibilidad
 * es pobre con algún manual concreto, agregamos parsing más fino en A.3.x.
 */
export default function StatBlockPanel({ statBlock }: Props) {
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <>
      <div className="rounded-md border border-parchment-700 bg-parchment-900/60 p-3 mt-1">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[11px] text-vellum-400">
            📖 <span className="text-gold-300">{statBlock.manual_name}</span>
            <span className="text-vellum-500"> · pág. {statBlock.page_number}</span>
          </span>
          <button
            onClick={() => setViewerOpen(true)}
            className="text-[10px] text-gold-400 hover:text-gold-300 transition-colors"
            title="Abrir la página del manual en un visor"
          >
            Abrir página ↗
          </button>
        </div>
        <pre className="font-mono text-[11px] text-vellum-100 whitespace-pre-wrap leading-relaxed max-h-[280px] overflow-y-auto">
          {statBlock.raw_text}
        </pre>
      </div>

      <ManualPageViewer
        open={viewerOpen}
        manualName={statBlock.manual_name}
        filePath={statBlock.manual_file_path}
        pageNumber={statBlock.page_number}
        onClose={() => setViewerOpen(false)}
      />
    </>
  );
}
