import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Tooltip from "./Tooltip";

type Variant = "default" | "active" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "title"> {
  /** Required label — appears in tooltip and as aria-label. */
  label: string;
  shortcut?: string;
  tooltipSide?: "top" | "bottom" | "left" | "right";
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  default:
    "text-vellum-300 hover:text-vellum-50 hover:bg-parchment-800",
  active:
    "text-gold-400 bg-parchment-800",
  danger:
    "text-vellum-300 hover:text-danger-300 hover:bg-danger-900/40",
  ghost:
    "text-vellum-400 hover:text-vellum-100",
};

const SIZES: Record<Size, string> = {
  sm: "w-7 h-7 text-sm rounded-md",
  md: "w-9 h-9 text-base rounded-md",
  lg: "w-11 h-11 text-lg rounded-lg",
};

const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  {
    label,
    shortcut,
    tooltipSide = "bottom",
    variant = "default",
    size = "md",
    children,
    className = "",
    ...rest
  },
  ref
) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        aria-label={label}
        className={`inline-flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500 disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});

export default IconButton;
