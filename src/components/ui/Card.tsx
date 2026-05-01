import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Visually elevated card with candlelight shadow. */
  raised?: boolean;
  /** Padding preset. */
  padding?: "none" | "sm" | "md" | "lg";
  /** Make card interactive (hover state). */
  interactive?: boolean;
}

const PADDING = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

const Card = forwardRef<HTMLDivElement, Props>(function Card(
  { children, raised, padding = "md", interactive, className = "", ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={`bg-parchment-900 border border-parchment-700 rounded-lg ${PADDING[padding]} ${raised ? "shadow-candlelight" : ""} ${interactive ? "transition-colors hover:border-parchment-600 cursor-pointer" : ""} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
});

export default Card;
