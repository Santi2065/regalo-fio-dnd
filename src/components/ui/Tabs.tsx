import type { ReactNode } from "react";

interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  badge?: ReactNode;
}

interface Props<K extends string> {
  items: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  /** Underline (default) or pills. */
  variant?: "underline" | "pills";
  /** Stretch tabs evenly. */
  fill?: boolean;
  className?: string;
}

export default function Tabs<K extends string>({
  items,
  active,
  onChange,
  variant = "underline",
  fill = false,
  className = "",
}: Props<K>) {
  if (variant === "pills") {
    return (
      <div className={`inline-flex gap-1 p-1 bg-parchment-800 rounded-lg ${className}`}>
        {items.map((it) => {
          const isActive = it.key === active;
          return (
            <button
              key={it.key}
              disabled={it.disabled}
              onClick={() => !it.disabled && onChange(it.key)}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                isActive
                  ? "bg-gold-600 text-parchment-950"
                  : "text-vellum-300 hover:text-vellum-50"
              }`}
            >
              {it.label}
              {it.badge}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`flex border-b border-parchment-800 ${className}`}>
      {items.map((it) => {
        const isActive = it.key === active;
        return (
          <button
            key={it.key}
            disabled={it.disabled}
            onClick={() => !it.disabled && onChange(it.key)}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed -mb-px border-b-2 ${
              fill ? "flex-1 justify-center" : ""
            } ${
              isActive
                ? "border-gold-500 text-gold-400"
                : "border-transparent text-vellum-300 hover:text-vellum-100 hover:border-parchment-600"
            }`}
          >
            {it.label}
            {it.badge}
          </button>
        );
      })}
    </div>
  );
}
