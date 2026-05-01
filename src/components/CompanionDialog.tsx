import { useEffect, useState } from "react";
import {
  companionStart,
  companionStop,
  companionStatus,
  companionGeneratePin,
  companionSetCharacters,
  companionKickPlayer,
  type CompanionStatus,
  type Character,
} from "../lib/companion";
import { toast } from "../lib/toast";
import { Button, IconButton, KeyboardKey, Modal } from "./ui";
import { readJSON, writeJSON } from "../lib/persistence";

interface Props {
  open: boolean;
  campaignName: string;
  onClose: () => void;
  onStatusChange?: (status: CompanionStatus) => void;
}

const POLL_INTERVAL_MS = 4000;
const CHARS_KEY = "companion-characters-v1";

const newCharId = () =>
  `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

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

  // Characters: persistidos en localStorage para que sobrevivan reloads del
  // dialog. El backend se hidrata desde acá al activar.
  const [characters, setCharacters] = useState<Character[]>(() =>
    readJSON<Character[]>(CHARS_KEY, [])
  );
  const [newCharName, setNewCharName] = useState("");

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
          // Si el server tiene characters (companion ya activo), sincronizamos
          // localStorage con el server para no perder datos cross-session.
          if (s.running && s.characters.length > 0) {
            setCharacters(s.characters);
          }
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

  // Persist characters al cambiar.
  useEffect(() => {
    writeJSON(CHARS_KEY, characters);
  }, [characters]);

  // Si el server está activo, mantener su lista de characters sincronizada.
  useEffect(() => {
    if (status?.running) {
      companionSetCharacters(characters).catch((e) =>
        console.error("[Companion] sync chars failed", e)
      );
    }
  }, [characters, status?.running]);

  const addCharacter = () => {
    const name = newCharName.trim();
    if (!name) return;
    if (characters.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast.error("Ya hay un personaje con ese nombre");
      return;
    }
    setCharacters((prev) => [...prev, { id: newCharId(), name }]);
    setNewCharName("");
  };

  const removeCharacter = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
  };

  const handleStart = async () => {
    if (characters.length === 0) {
      toast.error("Agregá al menos un personaje antes de activar");
      return;
    }
    setBusy(true);
    try {
      const pin = pinEnabled ? pinDraft : null;
      const info = await companionStart(pin, campaignName, characters);
      const next: CompanionStatus = {
        running: true,
        info,
        characters,
        connected: [],
      };
      setStatus(next);
      onStatusChange?.(next);
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
      const next: CompanionStatus = {
        running: false,
        info: null,
        characters,
        connected: [],
      };
      setStatus(next);
      onStatusChange?.(next);
      toast.info("Companion detenido");
    } catch (e) {
      console.error("[Companion] stop failed", e);
      toast.error("No se pudo detener el companion");
    } finally {
      setBusy(false);
    }
  };

  const handleKick = async (token: string, name: string) => {
    try {
      await companionKickPlayer(token);
      toast.info(`${name} desconectado`);
    } catch (e) {
      console.error("[Companion] kick failed", e);
      toast.error("No se pudo desconectar");
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
      /* ignore */
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
          ? "Tus jugadores escanean el QR y eligen su personaje."
          : "Cargá los personajes y activá el server local."
      }
    >
      {/* Characters section — visible siempre */}
      <div className="mb-5">
        <label className="block text-[10px] uppercase tracking-wider text-vellum-400 mb-2">
          Personajes ({characters.length})
        </label>
        <div className="space-y-1.5">
          {characters.length === 0 && (
            <p className="text-xs text-vellum-400">
              Agregá los nombres de los PJs para que aparezcan en el celu de los jugadores.
            </p>
          )}
          {characters.map((c) => {
            const isConnected = status?.connected.some(
              (p) => p.character.id === c.id
            );
            const conn = status?.connected.find(
              (p) => p.character.id === c.id
            );
            return (
              <div
                key={c.id}
                className="flex items-center gap-2 bg-parchment-800/50 border border-parchment-700 rounded-md px-2 py-1.5"
              >
                <span className="flex-1 text-sm text-vellum-100 truncate">
                  {c.name}
                </span>
                {isConnected && conn ? (
                  <>
                    <span className="text-[10px] text-success-300 flex items-center gap-1 flex-shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-success-500 animate-pulse" />
                      conectado
                    </span>
                    <IconButton
                      label={`Desconectar ${c.name}`}
                      variant="danger"
                      size="sm"
                      onClick={() => handleKick(conn.token, c.name)}
                    >
                      ⏏
                    </IconButton>
                  </>
                ) : (
                  <IconButton
                    label="Quitar personaje"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeCharacter(c.id)}
                  >
                    ×
                  </IconButton>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 mt-2">
          <input
            value={newCharName}
            onChange={(e) => setNewCharName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCharacter()}
            placeholder="Nombre del PJ"
            className="flex-1 bg-parchment-800 border border-parchment-700 rounded-md px-3 py-1.5 text-vellum-50 text-sm focus:outline-none focus:border-gold-500"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={addCharacter}
            disabled={!newCharName.trim()}
          >
            + Agregar
          </Button>
        </div>
      </div>

      {/* Activation / running state */}
      {running ? (
        <div className="space-y-4 pt-4 border-t border-parchment-800">
          <div className="flex justify-center bg-vellum-50 rounded-lg p-3">
            <div
              className="w-56 h-56"
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

          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success-500 animate-pulse" />
              <span className="text-xs text-success-300">
                {status!.connected.length === 0
                  ? "Sin jugadores conectados"
                  : `${status!.connected.length} conectado${
                      status!.connected.length === 1 ? "" : "s"
                    }`}
              </span>
            </div>
            <Button variant="danger" size="sm" onClick={handleStop} loading={busy}>
              Detener
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 pt-4 border-t border-parchment-800">
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
                Útil si compartís WiFi con vecinos / co-workers que no tienen
                que entrar a tu mesa.
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
            disabled={
              characters.length === 0 || (pinEnabled && pinDraft.length !== 4)
            }
            iconBefore="📡"
          >
            Activar companion
          </Button>

          <p className="text-[11px] text-vellum-400 leading-relaxed">
            Va a iniciar un server local en{" "}
            <code className="font-mono text-vellum-300">puerto 47823</code>.
            Tus jugadores y vos tienen que estar en la misma red WiFi.{" "}
            <KeyboardKey size="sm">Esc</KeyboardKey> cierra sin activar.
          </p>
        </div>
      )}
    </Modal>
  );
}
