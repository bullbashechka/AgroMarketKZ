import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { RegistrationSheet } from "../components/RegistrationSheet";
import { useAuth } from "./auth";

interface RegistrationIntentContextValue {
  requireRegistration: (after: () => void, reason?: string) => void;
}

const RegistrationIntentContext = createContext<RegistrationIntentContextValue | null>(null);

export function RegistrationIntentProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>();
  const continuationRef = useRef<(() => void) | null>(null);

  const value = useMemo<RegistrationIntentContextValue>(() => ({
    requireRegistration: (after, nextReason) => {
      if (profile?.isRegistered) {
        after();
        return;
      }
      continuationRef.current = after;
      setReason(nextReason);
      setOpen(true);
    },
  }), [profile?.isRegistered]);

  function close() {
    continuationRef.current = null;
    setOpen(false);
  }

  function complete() {
    const continuation = continuationRef.current;
    continuationRef.current = null;
    setOpen(false);
    continuation?.();
  }

  return (
    <RegistrationIntentContext.Provider value={value}>
      {children}
      <RegistrationSheet open={open} onClose={close} onRegistered={complete} reason={reason} />
    </RegistrationIntentContext.Provider>
  );
}

export function useRegistrationIntent(): RegistrationIntentContextValue {
  const context = useContext(RegistrationIntentContext);
  if (!context) throw new Error("useRegistrationIntent требует RegistrationIntentProvider");
  return context;
}
