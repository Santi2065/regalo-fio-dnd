import type { ReactNode } from "react";

interface Props {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  size?: "sm" | "md" | "lg";
}

const SIZES = {
  sm: { icon: "text-3xl", title: "text-sm", desc: "text-xs", padY: "py-8" },
  md: { icon: "text-5xl", title: "text-base", desc: "text-sm", padY: "py-14" },
  lg: { icon: "text-6xl", title: "text-lg", desc: "text-sm", padY: "py-20" },
};

export default function EmptyState({
  icon,
  title,
  description,
  action,
  size = "md",
}: Props) {
  const s = SIZES[size];
  return (
    <div className={`text-center ${s.padY} px-6 flex flex-col items-center`}>
      {icon && (
        <div className={`${s.icon} mb-3 text-vellum-400 opacity-60`} aria-hidden>
          {icon}
        </div>
      )}
      <h3 className={`${s.title} font-medium text-vellum-100 mb-1.5`}>{title}</h3>
      {description && (
        <p className={`${s.desc} text-vellum-400 max-w-md leading-relaxed`}>
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
