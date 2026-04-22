import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { getCachedDiscoverableAccounts, saveCachedDiscoverableAccounts } from "../lib/cache";

export interface DiscoverableAccount {
  biz: string;
  name: string;
  avatar_url?: string;
  description?: string;
  account_type?: string;
  already_subscribed: boolean;
}

export function useDiscoverableAccounts(targetUserId?: number, enabled = true) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["accounts", "discoverable", targetUserId ?? "self"],
    queryFn: async (): Promise<DiscoverableAccount[]> => {
      const qs = targetUserId ? `?target_user_id=${targetUserId}` : "";
      const resp = await apiFetch(`/accounts/discoverable${qs}`).then(r => r.json());
      const data: DiscoverableAccount[] = resp.status === "ok" ? resp.data : [];
      // Write-through to local cache (fire and forget)
      saveCachedDiscoverableAccounts(data as unknown as Record<string, unknown>[]).catch(() => {});
      return data;
    },
    staleTime: 30 * 1000,
    enabled,
    placeholderData: () => {
      // Use cached discoverable accounts if available in query cache
      return qc.getQueryData<DiscoverableAccount[]>(["accounts", "discoverable", targetUserId ?? "self"]);
    },
  });
}

/** Pre-warm discoverable accounts from local SQLite cache. */
export function usePrimeDiscoverableCache(targetUserId?: number, enabled = true) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["accounts", "discoverable", "_cache_prime", targetUserId ?? "self"],
    queryFn: async () => {
      const key = ["accounts", "discoverable", targetUserId ?? "self"];
      const existing = qc.getQueryData<DiscoverableAccount[]>(key);
      if (existing && existing.length > 0) return null;
      const cached = await getCachedDiscoverableAccounts();
      if (cached.length > 0) {
        const mapped: DiscoverableAccount[] = cached.map(c => ({
          biz: (c.biz as string) ?? "",
          name: (c.name as string) ?? "",
          avatar_url: c.avatar_url as string | undefined,
          description: c.description as string | undefined,
          account_type: c.account_type as string | undefined,
          already_subscribed: (c.already_subscribed as boolean) ?? false,
        }));
        qc.setQueryData(key, mapped);
      }
      return null;
    },
    staleTime: Infinity,
    enabled,
  });
}
