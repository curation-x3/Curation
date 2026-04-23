import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AnnotationRow,
  AdminCardRow,
  addAnnotation,
  deleteAnnotation,
  deleteVote,
  fetchAdminCards,
  fetchAnnotationsBatch,
  fetchAnnotationsSingle,
  fetchVotes,
  putVote,
} from "../lib/api";

export function useCardVotes(cardIds: string[]) {
  const key = ["votes", [...cardIds].sort().join(",")];
  return useQuery<Record<string, 1 | -1>>({
    queryKey: key,
    queryFn: () => fetchVotes(cardIds),
    enabled: cardIds.length > 0,
    staleTime: 30_000,
  });
}

export function useSetVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cardId, vote, current }: { cardId: string; vote: 1 | -1; current: 1 | -1 | null }) => {
      if (current === vote) {
        await deleteVote(cardId);
        return { card_id: cardId, vote: null } as const;
      }
      return putVote(cardId, vote);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["votes"] });
    },
  });
}

export function useCardAnnotationsSingle(cardId: string, enabled: boolean) {
  return useQuery<AnnotationRow[]>({
    queryKey: ["annotations", "single", cardId],
    queryFn: () => fetchAnnotationsSingle(cardId),
    enabled: enabled && !!cardId,
    staleTime: 5_000,
  });
}

export function useCardAnnotationsBatch(cardIds: string[], enabled: boolean) {
  const key = ["annotations", "batch", [...cardIds].sort().join(",")];
  return useQuery<Record<string, AnnotationRow[]>>({
    queryKey: key,
    queryFn: () => fetchAnnotationsBatch(cardIds),
    enabled: enabled && cardIds.length > 0,
    staleTime: 30_000,
  });
}

export function useAddAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cardId, label, note }: { cardId: string; label: string; note?: string }) =>
      addAnnotation(cardId, label, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotations"] });
      qc.invalidateQueries({ queryKey: ["admin-cards"] });
    },
  });
}

export function useDeleteAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteAnnotation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotations"] });
      qc.invalidateQueries({ queryKey: ["admin-cards"] });
    },
  });
}

export function useAdminCards(params: {
  has_annotation?: boolean;
  has_downvote?: boolean;
  routing?: string;
  order?: "recent" | "downvotes" | "annotations";
  limit?: number;
  offset?: number;
}, enabled: boolean) {
  return useQuery<AdminCardRow[]>({
    queryKey: ["admin-cards", params],
    queryFn: () => fetchAdminCards(params),
    enabled,
    staleTime: 10_000,
  });
}
