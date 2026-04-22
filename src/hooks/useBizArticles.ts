import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export interface BizArticle {
  short_id: string;
  title: string | null;
  publish_time: string | null;
  url: string;
  routing: string | null;
  queue_status: string | null;
}

export function useBizArticles(biz: string | null) {
  return useQuery({
    queryKey: ["admin-biz-articles", biz],
    queryFn: async (): Promise<BizArticle[]> => {
      if (!biz) return [];
      const resp = await apiFetch(
        `/api/admin/accounts/by-biz/${encodeURIComponent(biz)}/articles?limit=100`,
      ).then(r => r.json());
      return resp.status === "ok" ? resp.data : [];
    },
    enabled: !!biz,
    staleTime: 30_000,
  });
}
