"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { providers as PROVIDER_DEFS } from "./mock-providers";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/utils/supabase/client";
import { fetchAuthUser, syncAuthUser } from "@/lib/query/authUser";
import { qk } from "@/lib/query/keys";
import { FEATURES } from "./features";

type ConnectionState = {
  connected: boolean;
  apiKey: string; // client-side cache only; real value never round-trips from the server after connect()
  baseUrl?: string;
};

type ProvidersState = Record<string, ConnectionState>;

type Ctx = {
  state: ProvidersState;
  primaryModel: string | null;
  loading: boolean;
  platformProviders: string[];
  setPrimaryModel: (model: string) => void;
  connect: (providerId: string, apiKey: string, baseUrl?: string) => Promise<void>;
  disconnect: (providerId: string) => Promise<void>;
  connectedModels: { providerId: string; providerName: string; model: string }[];
};

type ProvidersResponse = {
  connections: { providerId: string; keyPreview: string; baseUrl?: string }[];
  primaryModel: string | null;
  platformProviders?: string[];
};

const ProvidersCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "okara.providers.v2";

export function useProviders() {
  const ctx = useContext(ProvidersCtx);
  if (!ctx) throw new Error("useProviders must be used within ProvidersProvider");
  return ctx;
}

function cacheKey(userId: string | null) {
  return `${STORAGE_KEY}:${userId ?? "anonymous"}`;
}

export default function ProvidersProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProvidersState>({});
  const [primaryModel, setPrimaryModelState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [platformProviders, setPlatformProviders] = useState<string[]>([]);

  const userIdRef = useRef<string | null>(null);
  const queryClient = useQueryClient();

  const persistCache = useCallback(
    (next: ProvidersState, primary: string | null, id = userIdRef.current) => {
      try {
        localStorage.setItem(cacheKey(id), JSON.stringify({ state: next, primaryModel: primary }));
      } catch {}
    },
    []
  );

  const clearSessionState = useCallback((id: string | null) => {
    userIdRef.current = id;
    setState({});
    setPrimaryModelState(null);
    setPlatformProviders([]);
    try {
      localStorage.removeItem(cacheKey(null));
      if (id) localStorage.removeItem(cacheKey(id));
    } catch {}
  }, []);

  const loadProviders = useCallback(
    async (id: string | null) => {
      if (FEATURES.PLATFORM_MODE && !id) {
        clearSessionState(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const raw = localStorage.getItem(cacheKey(id));
        if (raw) {
          const parsed = JSON.parse(raw);
          setState(parsed.state || {});
          setPrimaryModelState(parsed.primaryModel || null);
        }
      } catch {}

      try {
        // One shared query: concurrent callers (getUser result + auth event) join a
        // single /api/providers request instead of each issuing their own.
        const result = await queryClient.fetchQuery({
          queryKey: qk.providers(id),
          staleTime: 30_000,
          queryFn: async () => {
            const response = await fetch("/api/providers", { cache: "no-store" });
            if (response.status === 401 && FEATURES.PLATFORM_MODE) return { unauthorized: true as const };
            if (!response.ok) throw new Error("Failed to load providers");
            const body: ProvidersResponse = await response.json();
            return { unauthorized: false as const, body };
          },
        });
        if (result.unauthorized) {
          clearSessionState(null);
          return;
        }
        const data = result.body;

        const next: ProvidersState = {};
        for (const connection of data.connections) {
          next[connection.providerId] = { connected: true, apiKey: "", baseUrl: connection.baseUrl };
        }
        setState(next);
        setPrimaryModelState(data.primaryModel);
        setPlatformProviders(data.platformProviders ?? []);
        persistCache(next, data.primaryModel, id);
      } catch {
      } finally {
        setLoading(false);
      }
    },
    [clearSessionState, persistCache, queryClient]
  );

  useEffect(() => {
    let mounted = true;
    const supabase = createClient();
    void fetchAuthUser(queryClient)
      .catch(() => null)
      .then((user) => {
        if (!mounted) return;
        const id = user?.id ?? null;
        userIdRef.current = id;
        void loadProviders(id);
      });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const id = session?.user?.id ?? null;
      syncAuthUser(queryClient, session?.user ?? null);
      if (event === "SIGNED_OUT") {
        queryClient.removeQueries({ queryKey: qk.providers(userIdRef.current) });
        clearSessionState(null);
        setLoading(false);
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        if (id !== userIdRef.current) {
          userIdRef.current = id;
          void loadProviders(id);
        }
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [clearSessionState, loadProviders, queryClient]);

  const connect = useCallback(
    async (providerId: string, apiKey: string, baseUrl?: string) => {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, apiKey, baseUrl }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to connect");
      queryClient.removeQueries({ queryKey: qk.providers(userIdRef.current) });

      setState((prev) => {
        const next = { ...prev, [providerId]: { connected: true, apiKey: "", baseUrl } };
        persistCache(next, primaryModel);
        return next;
      });
    },
    [persistCache, primaryModel, queryClient]
  );

  const disconnect = useCallback(
    async (providerId: string) => {
      const res = await fetch(`/api/providers?providerId=${encodeURIComponent(providerId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to disconnect");
      queryClient.removeQueries({ queryKey: qk.providers(userIdRef.current) });

      setState((prev) => {
        const next = { ...prev, [providerId]: { connected: false, apiKey: "" } };
        persistCache(next, primaryModel);
        return next;
      });
    },
    [persistCache, primaryModel, queryClient]
  );

  const setPrimaryModel = useCallback(
    (model: string) => {
      setPrimaryModelState(model);
      persistCache(state, model);
      queryClient.removeQueries({ queryKey: qk.providers(userIdRef.current) });
      fetch("/api/providers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryModel: model }),
      }).catch(() => {
        // local state remains usable; the next backend reconciliation restores truth
      });
    },
    [persistCache, state, queryClient]
  );

  const connectedModels = PROVIDER_DEFS.filter(
    (p) => state[p.id]?.connected || platformProviders.includes(p.id)
  ).flatMap((p) => p.models.map((m) => ({ providerId: p.id, providerName: p.name, model: m })));


  return (
    <ProvidersCtx.Provider
      value={{ state, primaryModel, loading, platformProviders, setPrimaryModel, connect, disconnect, connectedModels }}
    >
      {children}
    </ProvidersCtx.Provider>
  );
}

export function findProviderForModel(model: string): string | null {
  const provider = PROVIDER_DEFS.find((p) => p.models.includes(model));
  return provider?.id ?? null;
}
