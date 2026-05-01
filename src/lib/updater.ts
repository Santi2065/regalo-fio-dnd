import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Auto-updater wrapper.
 *
 * Política de UX según pedido del user:
 * - Chequeo silencioso al arrancar.
 * - Si hay versión nueva, se descarga sola en background con toast de
 *   progreso.
 * - Cuando termina la instalación, se le pregunta al user si quiere
 *   reiniciar ahora o después.
 *
 * Errores que no son una versión nueva (network, sin firma válida, sin
 * release latest.json) se tragan silencioso — no queremos asustar al user
 * cada vez que abre la app sin internet. Solo log a consola.
 */

export interface UpdateProgress {
  /** Bytes descargados hasta el momento. */
  downloaded: number;
  /** Total esperado en bytes (si el server no manda Content-Length, undefined). */
  total: number | null;
  /** 0..1; null si no se conoce el total. */
  fraction: number | null;
}

export type UpdaterStage =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update; version: string; notes: string | null }
  | { kind: "downloading"; version: string; progress: UpdateProgress }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

/**
 * Chequea si hay update y devuelve el handle si lo hay. Devuelve null si
 * no hay update o si falla por algo no crítico (sin internet, etc).
 */
export async function checkForUpdate(): Promise<Update | null> {
  try {
    const u = await check();
    if (!u) return null;
    // El plugin devuelve un objeto incluso si no hay update; el flag
    // `available` distingue. La API en JS expone `currentVersion` y
    // `version`, comparamos para asegurar.
    if (u.version === u.currentVersion) return null;
    return u;
  } catch (e) {
    console.warn("[updater] check falló (probablemente sin internet)", e);
    return null;
  }
}

/**
 * Descarga e instala el update con callback de progreso.
 * Después de instalar, NO reinicia — eso lo hace el llamador con
 * relaunchApp() después de pedirle al user.
 */
export async function downloadAndInstall(
  update: Update,
  onProgress: (p: UpdateProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;

  await update.downloadAndInstall((event: DownloadEvent) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        downloaded = 0;
        onProgress({
          downloaded,
          total,
          fraction: total ? 0 : null,
        });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress({
          downloaded,
          total,
          fraction: total ? Math.min(1, downloaded / total) : null,
        });
        break;
      case "Finished":
        onProgress({
          downloaded: total ?? downloaded,
          total,
          fraction: 1,
        });
        break;
    }
  });
}

/** Cierra la app y la abre en su nueva versión. */
export async function relaunchApp(): Promise<void> {
  await relaunch();
}
