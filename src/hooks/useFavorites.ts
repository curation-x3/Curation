import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchFavorites, addFavorite, removeFavorite } from "../lib/api";
import type { FavoriteItem } from "../types";

export function useFavorites() {
  return useQuery<FavoriteItem[]>({
    queryKey: ["favorites"],
    queryFn: async () => {
      const data = await fetchFavorites();
      return data.items ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useFavoriteSet() {
  const { data: favorites } = useFavorites();
  return useMemo(() => {
    const set = new Set<string>();
    if (favorites) {
      for (const f of favorites) {
        set.add(`${f.item_type}:${f.item_id}`);
      }
    }
    return set;
  }, [favorites]);
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemType, itemId, isFavorited }: {
      itemType: "card" | "article";
      itemId: string;
      isFavorited: boolean;
    }) => {
      if (isFavorited) {
        await removeFavorite(itemType, itemId);
      } else {
        await addFavorite(itemType, itemId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorites"] });
    },
  });
}
