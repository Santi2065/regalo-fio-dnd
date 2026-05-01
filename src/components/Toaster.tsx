import { useToastStore, type ToastItem } from "../lib/toast";

const KIND_STYLES: Record<ToastItem["kind"], string> = {
  success: "bg-emerald-900/90 border-emerald-700 text-emerald-100",
  error: "bg-red-900/90 border-red-700 text-red-100",
  info: "bg-stone-800/90 border-stone-600 text-stone-100",
  warning: "bg-amber-900/90 border-amber-700 text-amber-100",
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
          className={`pointer-events-auto cursor-pointer flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border backdrop-blur shadow-lg text-sm transition-all animate-toast-in ${KIND_STYLES[t.kind]}`}
          role="status"
        >
          <span className="text-lg leading-none mt-0.5 flex-shrink-0" aria-hidden>
            {KIND_ICONS[t.kind]}
          </span>
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
            className="text-current/60 hover:text-current text-base leading-none flex-shrink-0 -mr-1"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
