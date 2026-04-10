import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { Account } from "../types";

async function fetchAccounts(): Promise<Account[]> {
  const resp = await apiFetch("/accounts").then(r => r.json());
  return resp.status === "ok" ? resp.data : [];
}

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
    staleTime: 5 * 60 * 1000,
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
