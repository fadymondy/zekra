import * as SecureStore from "expo-secure-store";
import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { zekraApi, type Brain } from "@/lib/api";
import { useAuth } from "@/providers/auth";

const BRAIN_KEY = "zekra.mobile.brain.v1";

type BrainContextValue = {
  brains: Brain[];
  current: Brain | null;
  namespace: string;
  loading: boolean;
  error: Error | null;
  select(namespace: string): Promise<void>;
  refresh(): Promise<unknown>;
};

const BrainContext = createContext<BrainContextValue | null>(null);

export function BrainProvider({ children }: PropsWithChildren) {
  const { token } = useAuth();
  const [namespace, setNamespace] = useState("");
  const query = useQuery({
    queryKey: ["brains", token],
    queryFn: () => zekraApi.brains(token!),
    enabled: !!token,
    staleTime: 30_000,
  });
  const brains = query.data?.brains ?? [];

  useEffect(() => {
    void SecureStore.getItemAsync(BRAIN_KEY).then((saved) => { if (saved) setNamespace(saved); });
  }, []);

  useEffect(() => {
    if (!brains.length) return;
    if (!brains.some((brain) => brain.namespace === namespace)) {
      const next = brains[0].namespace;
      setNamespace(next);
      void SecureStore.setItemAsync(BRAIN_KEY, next);
    }
  }, [brains, namespace]);

  const select = useCallback(async (next: string) => {
    setNamespace(next);
    await SecureStore.setItemAsync(BRAIN_KEY, next);
  }, []);

  const value = useMemo<BrainContextValue>(() => ({
    brains,
    current: brains.find((brain) => brain.namespace === namespace) ?? null,
    namespace,
    loading: query.isLoading,
    error: query.error,
    select,
    refresh: query.refetch,
  }), [brains, namespace, query.isLoading, query.error, query.refetch, select]);

  return <BrainContext.Provider value={value}>{children}</BrainContext.Provider>;
}

export function useBrains() {
  const value = useContext(BrainContext);
  if (!value) throw new Error("useBrains must be inside BrainProvider");
  return value;
}
