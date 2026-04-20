import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchCards } from "../lib/cache";
import type { SearchResult } from "../lib/cache";

export function useSearch() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: results, isLoading } = useQuery<SearchResult[]>({
    queryKey: ["search", debouncedQuery],
    queryFn: () => searchCards(debouncedQuery),
    enabled: debouncedQuery.length > 0,
    staleTime: Infinity,
  });

  return {
    query,
    setQuery,
    results: results ?? [],
    isLoading,
    isActive: query.length > 0,
  };
}
