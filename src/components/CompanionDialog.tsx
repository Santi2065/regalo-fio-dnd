import { useEffect, useState } from "react";
import {
  companionStart,
  companionStop,
  companionStatus,
  companionGeneratePin,
  type CompanionStatus,
} from "../lib/companion";
import { toast } from "../lib/toast";
import { Button, KeyboardKey, Modal } from "./ui";

interface Props {
  open: boolean;
  campaignName: string;
  onClose: () => void;
  onStatusChange?: (status: CompanionStatus) => void;
}

const POLL_INTERVAL_MS = 4000;

export default function CompanionDialog({
  open,
  campaignName,
  onClose,
  onStatusChange,
}: Props) {
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [pinEnabled, setPinEnabled] = useState(false);

  // Initial fetch + poll while dialog open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await companionStatus();
        if (!cancelled) {
          setStatus(s);
          onStatusChange?.(s);
        }
      } catch (e) {
        console.error("[Companion] status failed", e);
      }
    };
    refresh();
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, onStatusChange]);

  const handleStart = async () => {
    setBusy(true);
    try {
      const pin = pinEnabled ? pinDraft : null;
      const info = await companionStart(pin, campaignName);
      setStatus({ running: true, info, connected_players: 0 });
      onStatusChange?.({ running: true, info, connected_players: 0 });
      toast.success("Companion activo · compartí el QR");
    } catch (e) {
      console.error("[Companion] start failed", e);
      const detail = typeof e === "string" ? e : (e as Error)?.message ?? "";
      toast.error(detail ? `No se pudo iniciar: ${detail}` : "No se pudo iniciar el companion");
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      await companionStop();
      setStatus({ running: false, info: null, connected_players: 0 });
      onStatusChange?.({ running: false, info: null, connected_players: 0 });
      toast.info("Companion detenido");
    } catch (e) {
      console.error("[Companion] stop failed", e);
      toast.error("No se pudo detener el companion");
    } finally {
      setBusy(false);
    }
  };

  const generatePin = async () => {
    try {
      const p = await companionGeneratePin();
      setPinDraft(p);
      setPinEnabled(true);
    } catch (e) {
      console.error("[Companion] generate pin failed", e);
    }
  };

  const handleCopyUrl = async () => {
    if (!status?.info) return;
    try {
      await navigator.clipboard.writeText(status.info.url);
      toast.success("URL copiada");
    } catch {
      /* clipboard puede estar bloqueado en algunos contextos */
    }
  };

  const running = status?.running && status.info;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="📡 Compartir con jugadores"
      description={
        running
          ? "Tus jugadores escanean el QR desde el celu y se conectan."
          : "Activá el server local para que los jugadores se conecten desde su celu por WiFi."
      }
    >
      {running ? (
        <div className="space-y-4">
          <div className="flex justify-center bg-vellum-50 rounded-lg p-3">
            <div
              className="w-56 h-56"
              // El SVG viene del backend (qrcode crate). Es markup estático,
              // sin scripts ni interpolación de datos del usuario, así que
              // dangerouslySetInnerHTML es seguro acá.
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: status!.info!.qr_svg }}
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-vellum-400 mb-1">
              URL
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-parchment-800 border border-parchment-700 rounded-md px-3 py-2 text-vellum-100 font-mono text-sm truncate">
                {status!.info!.url}
              </code>
              <Button variant="secondary" size="sm" onClick={handleCopyUrl}>
                Copiar
              </Button>
            </div>
          </div>

          {status!.info!.pin && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-vellum-400 mb-1">
                PIN
              </label>
              <div className="flex gap-2">
                {status!.info!.pin.split("").map((c, i) => (
                  <span
                    key={i}
                    className="w-10 h-12 flex items-center justify-center bg-parchment-800 border border-parchment-700 rounded-md text-2xl font-mono text-gold-300"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-parchment-800">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success-500 animate-pulse" />
              <span className="text-xs text-success-300">
                {status!.connected_players === 0
                  ? "Sin jugadores conectados"
                  : `${status!.connected_players} conectado${
                      status!.connected_players === 1 ? "" : "s"
                    }`}
              </span>
            </div>
            <Button variant="danger" size="sm" onClick={handleStop} loading={busy}>
              Detener
            </Button>
          </div>

          <p className="text-[11px] text-vellum-400 leading-relaxed">
            Los jugadores y vos tienen que estar en la misma red WiFi. Si el QR
            no funciona, pueden tipear la URL directo en el navegador del celu.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={pinEnabled}
              onChange={(e) => setPinEnabled(e.target.checked)}
              className="mt-1 accent-gold-500"
            />
            <div className="flex-1">
              <div className="text-sm text-vellum-100">Pedir PIN al conectar</div>
              <div className="text-xs text-vellum-400 mt-0.5">
                Opcional. Útil si compartís WiFi con vecinos / co-workers que no
                tienen que entrar a tu mesa.
              </div>
            </div>
          </label>

          {pinEnabled && (
            <div className="flex items-center gap-2 ml-7">
              <input
                value={pinDraft}
                onChange={(e) =>
                  setPinDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))
                }
                placeholder="0000"
                maxLength={4}
                className="w-24 bg-parchment-800 border border-parchment-700 rounded-md px-3 py-2 text-vellum-100 text-center text-2xl font-mono tracking-widest focus:outline-none focus:border-gold-500"
                inputMode="numeric"
              />
              <Button variant="ghost" size="sm" onClick={generatePin}>
                Generar
              </Button>
            </div>
          )}

          <Button
            variant="primary"
            fullWidth
            size="lg"
            onClick={handleStart}
            loading={busy}
            disabled={pinEnabled && pinDraft.length !== 4}
            iconBefore="📡"
          >
            Activar companion
          </Button>

          <p className="text-[11px] text-vellum-400 leading-relaxed">
            Va a iniciar un server local en{" "}
            <code className="font-mono text-vellum-300">puerto 47823</code> de tu
            máquina. <KeyboardKey size="sm">Esc</KeyboardKey> cierra este diálogo
            sin activar nada.
          </p>
        </div>
      )}
    </Modal>
  );
}
