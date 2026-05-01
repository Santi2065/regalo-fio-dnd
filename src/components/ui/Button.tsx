import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: Variant;
  size?: Size;
  iconBefore?: ReactNode;
  iconAfter?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gold-600 hover:bg-gold-500 text-parchment-950 font-medium shadow-sm hover:shadow-candlelight border border-gold-700/50",
  secondary:
    "bg-parchment-800 hover:bg-parchment-700 text-vellum-100 border border-parchment-700",
  ghost:
    "bg-transparent hover:bg-parchment-800 text-vellum-200 hover:text-vellum-50",
  danger:
    "bg-danger-700 hover:bg-danger-500 text-vellum-50 border border-danger-700/60",
  outline:
    "bg-transparent border border-gold-600 text-gold-400 hover:bg-gold-600/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-sm gap-2 rounded-md",
  lg: "h-11 px-5 text-base gap-2 rounded-lg",
};

const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = "secondary",
    size = "md",
    iconBefore,
    iconAfter,
    loading,
    fullWidth,
    children,
    className = "",
    disabled,
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500 ${VARIANTS[variant]} ${SIZES[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading ? (
        <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        iconBefore
      )}
      {children && <span>{children}</span>}
      {!loading && iconAfter}
    </button>
  );
});

export default Button;
