import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PayNetwork } from "../lib/pay-attest";

interface PaySessionValue {
  network: PayNetwork | null;
  choose: (network: PayNetwork) => void;
  clear: () => void;
}

const PaySessionContext = createContext<PaySessionValue | null>(null);

export function PaySessionProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<PayNetwork | null>(null);
  const choose = useCallback((next: PayNetwork) => {
    setNetwork(next);
  }, []);
  const clear = useCallback(() => {
    setNetwork(null);
  }, []);
  const value = useMemo(() => ({ network, choose, clear }), [network, choose, clear]);
  return <PaySessionContext.Provider value={value}>{children}</PaySessionContext.Provider>;
}

export function usePaySession(): PaySessionValue {
  const value = useContext(PaySessionContext);
  if (!value) {
    throw new Error("Pay session is missing.");
  }
  return value;
}
