import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { getCachedAccounts, saveCachedAccounts } from "../lib/cache";
import type { Account } from "../types";

async function fetchAndCacheAccounts(): Promise<Account[]> {
  const resp = await apiFetch("/accounts").then(r => r.json());
  const data: Account[] = resp.status === "ok" ? resp.data : [];
  // Write-through to local SQLite cache (fire and forget)
  saveCachedAccounts(data as unknown as Record<string, unknown>[]).catch(() => {});
  return data;
}

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAndCacheAccounts,
    staleTime: 5 * 60 * 1000,
    placeholderData: () => {
      // Synchronously return undefined — the initialDataUpdatedAt trick
      // won't work here because getCachedAccounts is async. Instead we
      // prime the cache in a separate query below.
      return undefined;
    },
  });
}

/** Pre-warm the accounts query with local SQLite data so the sidebar renders instantly. */
export function usePrimeAccountsCache(enabled = true) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["accounts", "_cache_prime"],
    queryFn: async () => {
      // Only prime if the main query has no data yet
      const existing = qc.getQueryData<Account[]>(["accounts"]);
      if (existing && existing.length > 0) return null;
      const cached = await getCachedAccounts();
      if (cached.length > 0) {
        const mapped: Account[] = cached.map(c => ({
          id: c.id,
          biz: c.biz,
          name: c.name ?? "",
          avatar_url: c.avatar_url ?? undefined,
          description: c.description ?? undefined,
          last_monitored_at: c.last_monitored_at ?? undefined,
          article_count: c.article_count ?? undefined,
          subscription_type: (c.subscription_type as Account["subscription_type"]) ?? undefined,
          sync_count: c.sync_count ?? undefined,
        }));
        qc.setQueryData(["accounts"], mapped);
      }
      return null;
    },
    staleTime: Infinity, // Only run once
    enabled,
  });
}

export function useUnsubscribe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: number) => {
      const res = await apiFetch(`/accounts/${accountId}/unsubscribe`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useResubscribe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: number) => {
      const res = await apiFetch(`/accounts/${accountId}/resubscribe`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}
