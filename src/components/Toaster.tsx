import { useToastStore, type ToastItem } from "../lib/toast";

const KIND_STYLES: Record<ToastItem["kind"], string> = {
  success: "bg-success-900/90 border-success-700 text-success-300",
  error: "bg-danger-900/90 border-danger-700 text-danger-300",
  info: "bg-parchment-800/95 border-parchment-600 text-vellum-100",
  warning: "bg-warning-700/40 border-warning-700 text-warning-300",
};

const KIND_ICONS: Record<ToastItem["kind"], string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
  warning: "⚠",
};

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-sm"
      role="region"
      aria-live="polite"
      aria-label="Notificaciones"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto cursor-pointer flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border backdrop-blur shadow-candlelight text-sm transition-all animate-toast-in ${KIND_STYLES[t.kind]}`}
          role="status"
        >
          <span className="text-lg leading-none mt-0.5 flex-shrink-0" aria-hidden>
            {KIND_ICONS[t.kind]}
          </span>
          <span className="flex-1 leading-snug text-vellum-50">{t.message}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
            className="text-vellum-400 hover:text-vellum-100 text-base leading-none flex-shrink-0 -mr-1"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
