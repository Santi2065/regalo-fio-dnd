import { create } from "zustand";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  duration: number;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (kind: ToastKind, message: string, duration?: number) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 2500,
  info: 2500,
  warning: 4000,
  error: 5000,
};

let counter = 0;
const newId = () => `t-${++counter}-${Date.now()}`;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (kind, message, duration) => {
    const id = newId();
    const ms = duration ?? DEFAULT_DURATION[kind];
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, duration: ms }] }));
    if (ms > 0) {
      setTimeout(() => {
        get().dismiss(id);
      }, ms);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().push("success", message, duration),
  error: (message: string, duration?: number) =>
    useToastStore.getState().push("error", message, duration),
  info: (message: string, duration?: number) =>
    useToastStore.getState().push("info", message, duration),
  warning: (message: string, duration?: number) =>
    useToastStore.getState().push("warning", message, duration),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};
