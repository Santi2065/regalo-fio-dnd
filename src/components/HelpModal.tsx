import { useState } from "react";
import { Modal, Tabs, KeyboardKey, Card } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = "shortcuts" | "cues" | "tips";

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: "Herramientas en mesa",
    items: [
      { keys: ["Ctrl", "R"], description: "Tirar dados (1d20+5, 4d6kh3, adv...)" },
      { keys: ["Ctrl", "G"], description: "Generar NPC, taberna, botín o clima" },
      { keys: ["Ctrl", "K"], description: "Buscar en los manuales cargados" },
      { keys: ["Ctrl", "M"], description: "Mandar handout (requiere companion activo)" },
    ],
  },
  {
    group: "Navegación principal",
    items: [
      { keys: ["Ctrl", "1"], description: "Ir a Guión" },
      { keys: ["Ctrl", "2"], description: "Ir a Biblioteca" },
      { keys: ["Ctrl", "3"], description: "Ir a Fichas" },
    ],
  },
  {
    group: "Panel de herramientas",
    items: [
      { keys: ["Ctrl", "4"], description: "Sonido (soundboard)" },
      { keys: ["Ctrl", "5"], description: "Proyección" },
      { keys: ["Ctrl", "6"], description: "Iniciativa" },
      { keys: ["Ctrl", "7"], description: "Notas" },
      { keys: ["Ctrl", "\\"], description: "Colapsar / expandir panel" },
    ],
  },
  {
    group: "Edición",
    items: [
      { keys: ["Ctrl", "S"], description: "Guardar guión / nota" },
      { keys: ["Tab"], description: "Insertar 2 espacios (en editores)" },
      { keys: ["Esc"], description: "Cancelar edición / cerrar modal" },
    ],
  },
  {
    group: "Soundboard",
    items: [
      { keys: ["Click"], description: "Disparar sonido" },
      { keys: ["Click derecho"], description: "Editar celda (label, hotkey, color)" },
    ],
  },
];

const CUE_EXAMPLES = [
  {
    syntax: "%%sfx:id:Nombre%%",
    title: "Efecto puntual",
    description: "Dispara una vez. Ideal para vidrios rotos, espadazos, hechizos.",
    color: "text-info-300",
    bg: "bg-info-700/20 border-info-700/40",
  },
  {
    syntax: "%%ambient:id:Nombre%%",
    title: "Música de ambiente",
    description: "Loop activable/desactivable. Para tabernas, bosques, dungeons.",
    color: "text-success-300",
    bg: "bg-success-900/30 border-success-700/40",
  },
  {
    syntax: "%%project:id:Nombre%%",
    title: "Proyección",
    description: "Muestra una imagen o video en la pantalla del jugador.",
    color: "text-copper-400",
    bg: "bg-copper-700/20 border-copper-700/40",
  },
];

const TIPS: { title: string; body: string }[] = [
  {
    title: "Arrastrá assets al guión",
    body:
      "Cuando estás escribiendo el guión en modo Prep, podés arrastrar audio o imágenes desde el panel de la derecha directamente al texto. Se convierten en cues automáticamente.",
  },
  {
    title: "Click derecho para editar el soundboard",
    body:
      "En el soundboard, click izquierdo dispara el sonido y click derecho abre un menú para cambiar el label, asignar un hotkey o pintar la celda de un color.",
  },
  {
    title: "Modo Live vs Prep",
    body:
      "En Prep escribís el guión libremente. Al pasar a Live, el guión queda en solo-lectura y los cues se vuelven botones que disparan sonidos / proyección. Los cambios se guardan automáticamente al cambiar de modo.",
  },
  {
    title: "Niebla de guerra",
    body:
      "Solo está disponible cuando hay una imagen proyectada. Activá la niebla, elegí 'Revelar' u 'Ocultar' y pintá sobre el mapa para ir descubriendo zonas durante la sesión.",
  },
  {
    title: "Los hotkeys del soundboard funcionan en cualquier pestaña",
    body:
      "Una vez que asignás una tecla a una celda, esa tecla dispara el sonido sin importar en qué tab estés (excepto si estás escribiendo en un input).",
  },
];

export default function HelpModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("shortcuts");

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Ayuda" description="Atajos, sintaxis de cues y tips para sacarle todo el jugo a la app.">
      <Tabs<Tab>
        items={[
          { key: "shortcuts", label: "Atajos" },
          { key: "cues", label: "Sintaxis de cues" },
          { key: "tips", label: "Tips" },
        ]}
        active={tab}
        onChange={setTab}
        className="mb-4"
      />

      {tab === "shortcuts" && (
        <div className="space-y-5">
          {SHORTCUTS.map((g) => (
            <div key={g.group}>
              <h3 className="text-vellum-200 text-xs font-semibold uppercase tracking-wider mb-2">
                {g.group}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {g.items.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 py-1.5 px-2.5 rounded-md hover:bg-parchment-800/60"
                  >
                    <span className="text-vellum-100 text-sm">{s.description}</span>
                    <span className="flex gap-1 flex-shrink-0">
                      {s.keys.map((k, j) => (
                        <KeyboardKey key={j}>{k}</KeyboardKey>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "cues" && (
        <div className="space-y-3">
          <p className="text-vellum-300 text-sm leading-relaxed mb-2">
            Los cues son tokens que escribís dentro del guión y se convierten en
            botones interactivos cuando pasás a modo Live. Hay tres tipos:
          </p>
          {CUE_EXAMPLES.map((c) => (
            <Card key={c.syntax} padding="md" className={c.bg}>
              <code className={`font-mono text-sm ${c.color} block mb-1.5`}>
                {c.syntax}
              </code>
              <div className="text-vellum-100 font-medium text-sm">{c.title}</div>
              <div className="text-vellum-300 text-xs mt-0.5 leading-relaxed">
                {c.description}
              </div>
            </Card>
          ))}
          <Card padding="md" className="bg-parchment-800/50 mt-2">
            <p className="text-vellum-300 text-xs leading-relaxed">
              <strong className="text-vellum-100">Atajo:</strong> en lugar de
              escribir los cues a mano, arrastrá un asset desde el panel
              izquierdo al guión y se inserta el cue automáticamente con el id
              correcto.
            </p>
          </Card>
        </div>
      )}

      {tab === "tips" && (
        <div className="space-y-3">
          {TIPS.map((t) => (
            <Card key={t.title} padding="md" className="bg-parchment-800/40">
              <h4 className="text-vellum-100 font-medium text-sm mb-1">{t.title}</h4>
              <p className="text-vellum-300 text-xs leading-relaxed">{t.body}</p>
            </Card>
          ))}
        </div>
      )}
    </Modal>
  );
}
