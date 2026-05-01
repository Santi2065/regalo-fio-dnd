interface Props {
  className?: string;
  /** Display as a rounded rectangle (default) or a circle. */
  shape?: "rect" | "circle";
}

export default function Skeleton({ className = "", shape = "rect" }: Props) {
  return (
    <div
      className={`animate-shimmer ${shape === "circle" ? "rounded-full" : "rounded-md"} ${className}`}
      aria-hidden
    />
  );
}
