interface Props {
  children: React.ReactNode;
  size?: "sm" | "md";
  className?: string;
}

const SIZES = {
  sm: "text-[10px] px-1 py-0 min-w-[16px] h-4",
  md: "text-xs px-1.5 py-0.5 min-w-[20px] h-5",
};

export default function KeyboardKey({ children, size = "md", className = "" }: Props) {
  return (
    <kbd
      className={`inline-flex items-center justify-center rounded border border-parchment-600 bg-parchment-800 text-vellum-200 font-mono leading-none ${SIZES[size]} ${className}`}
    >
      {children}
    </kbd>
  );
}
