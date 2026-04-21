import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getFavorites, getInboxCards, toggleFavoriteLocal } from "../lib/cache";
import type { FavoriteItem } from "../types";

export function useFavorites() {
  return useQuery<FavoriteItem[]>({
    queryKey: ["favorites", "local"],
    queryFn: async () => {
      const [rawFavorites, cards] = await Promise.all([
        getFavorites(),
        getInboxCards(null, false),
      ]);

      // Build a map for O(1) card lookups
      const cardMap = new Map(cards.map((c) => [c.card_id, c]));

      // Sort newest first (matches HTTP version behaviour)
      const sorted = [...rawFavorites].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      return sorted.map((fav): FavoriteItem => {
        if (fav.item_type === "card") {
          const card = cardMap.get(fav.item_id);
          return {
            item_type: "card",
            item_id: fav.item_id,
            created_at: fav.created_at,
            title: card?.title ?? null,
            description: card?.description ?? null,
            routing: (card?.routing as FavoriteItem["routing"]) ?? null,
            article_id: card?.article_id ?? null,
            article_title: card?.title ?? null,
            article_account: card?.account ?? null,
            article_meta: card
              ? {
                  title: card.title ?? "",
                  account: card.account ?? "",
                  account_id: null,
                  author: card.author ?? null,
                  publish_time: card.article_date ?? null,
                  url: card.url ?? "",
                }
              : null,
          };
        }
        // item_type === "article": no local articles table; return with empty meta
        return {
          item_type: "article",
          item_id: fav.item_id,
          created_at: fav.created_at,
          title: null,
          description: null,
          routing: null,
          article_id: fav.item_id,
          article_title: null,
          article_account: null,
          article_meta: null,
        };
      });
    },
    staleTime: 0,
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
    mutationFn: ({ itemType, itemId, isFavorited }: {
      itemType: "card" | "article";
      itemId: string;
      isFavorited: boolean;
    }) => toggleFavoriteLocal(itemType, itemId, !isFavorited),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorites", "local"] });
    },
  });
}
