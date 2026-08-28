"use client";

/*
 * Toast (D1): transient confirmation, bottom-centred, self-dismissing.
 * A toast REPORTS an outcome in the same words as the action that caused
 * it ("Sealed" after "Seal my allocation") — it never asks for anything,
 * and there is no error toast: failures render in place, with the fix.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  tone: "ink" | "prize";
}

const ToastContext = createContext<{ show: (message: string, tone?: "ink" | "prize") => void }>({
  show: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, tone: "ink" | "prize" = "ink") => {
    const id = nextId.current++;
    setItems((xs) => [...xs, { id, message, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3200);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={
              "animate-rise rounded-full border px-5 py-2.5 text-[15px] font-medium " +
              (t.tone === "prize"
                ? "border-prize/40 bg-overlay text-prize"
                : "border-line bg-overlay text-ink")
            }
            style={{ boxShadow: "var(--elevation-card)" }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
