import type { ReactNode } from "react";

type Variant = "neutral" | "success" | "danger" | "warning" | "info" | "accent";

interface Props {
  children: ReactNode;
  variant?: Variant;
  size?: "sm" | "md";
  className?: string;
}

const VARIANTS: Record<Variant, string> = {
  neutral: "bg-parchment-800 text-vellum-200 border-parchment-700",
  success: "bg-success-900/40 text-success-300 border-success-700/40",
  danger:  "bg-danger-900/40 text-danger-300 border-danger-700/40",
  warning: "bg-warning-700/30 text-warning-300 border-warning-700/40",
  info:    "bg-info-700/30 text-info-300 border-info-700/40",
  accent:  "bg-gold-900/40 text-gold-300 border-gold-700/40",
};

const SIZES = {
  sm: "text-[10px] px-1.5 py-0",
  md: "text-xs px-2 py-0.5",
};

export default function Badge({
  children,
  variant = "neutral",
  size = "md",
  className = "",
}: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium leading-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {children}
    </span>
  );
}
