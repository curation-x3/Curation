import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchCards, hydrateSearchResults } from "../lib/cache";
import { searchCardsRemote } from "../lib/api";
import type { SearchResult } from "../lib/cache";

interface SearchState {
  results: SearchResult[];
  semanticAvailable: boolean;
}

export function useSearch() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isLoading } = useQuery<SearchState>({
    queryKey: ["search", debouncedQuery],
    queryFn: async () => {
      try {
        const remote = await searchCardsRemote(debouncedQuery, 20);
        const localMeta = await hydrateSearchResults(remote.items.map((r) => r.card_id));
        const byId = new Map(localMeta.map((r) => [r.card_id, r]));
        const results = remote.items
          .map((r) => {
            const meta = byId.get(r.card_id);
            if (!meta) return null;
            return { ...meta, highlight: r.highlight };
          })
          .filter((x): x is SearchResult => x !== null);
        return { results, semanticAvailable: remote.semantic_available };
      } catch {
        const fallback = await searchCards(debouncedQuery);
        return { results: fallback, semanticAvailable: false };
      }
    },
    enabled: debouncedQuery.length > 0,
    staleTime: Infinity,
  });

  return {
    query,
    setQuery,
    results: data?.results ?? [],
    semanticAvailable: data?.semanticAvailable ?? true,
    isLoading,
    isActive: query.length > 0,
  };
}
