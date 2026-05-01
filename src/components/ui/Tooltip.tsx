import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import KeyboardKey from "./KeyboardKey";

interface Props {
  content: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
  children: ReactNode;
}

const SIDE_OFFSET = 8;

export default function Tooltip({
  content,
  shortcut,
  side = "bottom",
  delay = 400,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const computePosition = useCallback(() => {
    if (!wrapperRef.current || !tooltipRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const tw = tooltipRef.current.offsetWidth;
    const th = tooltipRef.current.offsetHeight;

    let top = 0;
    let left = 0;
    if (side === "bottom") {
      top = rect.bottom + SIDE_OFFSET;
      left = rect.left + rect.width / 2 - tw / 2;
    } else if (side === "top") {
      top = rect.top - th - SIDE_OFFSET;
      left = rect.left + rect.width / 2 - tw / 2;
    } else if (side === "right") {
      top = rect.top + rect.height / 2 - th / 2;
      left = rect.right + SIDE_OFFSET;
    } else {
      top = rect.top + rect.height / 2 - th / 2;
      left = rect.left - tw - SIDE_OFFSET;
    }

    const margin = 6;
    left = Math.max(margin, Math.min(window.innerWidth - tw - margin, left));
    top = Math.max(margin, Math.min(window.innerHeight - th - margin, top));

    setCoords({ top, left });
  }, [side]);

  useEffect(() => {
    if (!open) return;
    computePosition();
    const onScrollOrResize = () => computePosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, computePosition]);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <>
      <span
        ref={wrapperRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex"
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            style={{ top: coords?.top ?? -9999, left: coords?.left ?? -9999 }}
            className="fixed z-[10000] px-2.5 py-1.5 rounded-md bg-parchment-900 border border-parchment-700 text-vellum-100 text-xs shadow-candlelight pointer-events-none animate-tooltip-in flex items-center gap-2 max-w-xs"
          >
            <span>{content}</span>
            {shortcut && <KeyboardKey size="sm">{shortcut}</KeyboardKey>}
          </div>,
          document.body
        )}
    </>
  );
}
