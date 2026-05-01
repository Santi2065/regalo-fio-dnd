import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Size = "sm" | "md" | "lg" | "xl";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: Size;
  /** Disable closing on backdrop click. */
  persistent?: boolean;
}

const SIZES: Record<Size, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  persistent = false,
}: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  // Esc to close + focus trap (basic)
  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !persistent) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);

    // Focus the dialog so Esc reaches it
    setTimeout(() => dialogRef.current?.focus(), 0);

    // Body scroll lock
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      lastFocused.current?.focus?.();
    };
  }, [open, onClose, persistent]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-4 animate-backdrop-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "modal-title" : undefined}
    >
      <div
        className="absolute inset-0 bg-parchment-950/80 backdrop-blur-sm"
        onClick={persistent ? undefined : onClose}
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`relative w-full ${SIZES[size]} bg-parchment-900 border border-parchment-700 rounded-xl shadow-candlelight animate-modal-in flex flex-col max-h-[90vh] outline-none`}
      >
        {(title || description) && (
          <div className="px-5 py-4 border-b border-parchment-800 flex-shrink-0">
            {title && (
              <h2 id="modal-title" className="text-vellum-50 font-display text-lg leading-snug">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-vellum-300 text-sm mt-1 leading-snug">{description}</p>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-parchment-800 flex justify-end gap-2 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
