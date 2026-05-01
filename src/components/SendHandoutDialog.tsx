import { useEffect, useState } from "react";
import {
  companionSendHandout,
  companionStatus,
  type ConnectedPlayer,
} from "../lib/companion";
import { toast } from "../lib/toast";
import { Button, Modal } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill body (ej: nota seleccionada). */
  initialBody?: string;
  /** Pre-fill title (ej: nombre del asset). */
  initialTitle?: string;
}

type Target = "all" | string; // "all" or token

export default function SendHandoutDialog({
  open,
  onClose,
  initialBody = "",
  initialTitle = "",
}: Props) {
  const [target, setTarget] = useState<Target>("all");
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [connected, setConnected] = useState<ConnectedPlayer[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setBody(initialBody);
    setTarget("all");
    companionStatus()
      .then((s) => {
        setRunning(s.running);
        setConnected(s.connected);
      })
      .catch((e) => console.error("[SendHandoutDialog] status failed", e));
  }, [open, initialTitle, initialBody]);

  const handleSend = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const toToken = target === "all" ? null : target;
      await companionSendHandout(toToken, title.trim() || null, body.trim());
      const targetName =
        target === "all"
          ? "todos"
          : connected.find((p) => p.token === target)?.character.name ?? "player";
      toast.success(`Handout enviado a ${targetName}`);
      onClose();
    } catch (e) {
      console.error("[SendHandoutDialog] send failed", e);
      const detail = typeof e === "string" ? e : (e as Error)?.message ?? "";
      toast.error(detail ? `No se pudo enviar: ${detail}` : "No se pudo enviar el handout");
    } finally {
      setBusy(false);
    }
  };

  if (!running) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="sm"
        title="📨 Mandar handout"
        description="Activá el companion primero para que los jugadores estén conectados."
        footer={
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        }
      >
        <p className="text-sm text-vellum-300">
          Abrí el botón <strong>📡 Compartir</strong> del header y activá el companion.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="📨 Mandar handout"
      description="Mandá texto al celu de uno o todos los jugadores conectados."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSend}
            loading={busy}
            disabled={!body.trim()}
            iconBefore="📨"
          >
            Enviar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-vellum-400 mb-1.5">
            Destinatario
          </label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as Target)}
            className="w-full bg-parchment-800 border border-parchment-700 rounded-md px-3 py-2 text-vellum-100 text-sm focus:outline-none focus:border-gold-500"
          >
            <option value="all">📨 Todos los jugadores</option>
            {connected.length === 0 && (
              <option disabled>(sin jugadores conectados)</option>
            )}
            {connected.map((p) => (
              <option key={p.token} value={p.token}>
                🔒 {p.character.name} (privado)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-vellum-400 mb-1.5">
            Título <span className="lowercase normal-case">(opcional)</span>
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ej: Carta del barón"
            className="w-full bg-parchment-800 border border-parchment-700 rounded-md px-3 py-2 text-vellum-50 text-sm focus:outline-none focus:border-gold-500"
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-vellum-400 mb-1.5">
            Mensaje <span className="text-danger-300">*</span>
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Texto que va a aparecer en el celu del player..."
            rows={6}
            className="w-full bg-parchment-800 border border-parchment-700 rounded-md px-3 py-2 text-vellum-50 placeholder-vellum-400 text-sm focus:outline-none focus:border-gold-500 resize-y"
            autoFocus={!initialBody}
          />
          <p className="text-[10px] text-vellum-400 mt-1">
            El celu del player vibra cuando recibe el handout.
          </p>
        </div>
      </div>
    </Modal>
  );
}
