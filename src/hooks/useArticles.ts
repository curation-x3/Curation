import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { Article } from "../types";

async function fetchArticleList(accountId: number): Promise<Article[]> {
  const path = accountId === -1 ? "/articles" : `/articles?account_id=${accountId}`;
  const resp = await apiFetch(path).then(r => r.json());
  return resp.status === "ok" ? resp.data : [];
}

export interface ArticleContent {
  markdown?: string;
  cards?: Article["cards"];
  article_meta?: Article["article_meta"];
  rawMarkdown?: string;
  rawHtml?: string;
  contentFormat?: "html" | "markdown";
  serving_run_id?: number;
  content_source: Article["content_source"];
  summaryWordCount: number;
  rawWordCount: number;
  analysisStatus: "none" | "pending" | "running" | "done" | "failed";
}

export async function fetchArticleContent(articleId: string): Promise<ArticleContent> {
  const [resp, rawResp, statusResp] = await Promise.all([
    apiFetch(`/articles/${articleId}/content`).then(r => r.json()),
    apiFetch(`/articles/${articleId}/raw`).then(r => r.json()),
    apiFetch(`/articles/${articleId}/analysis-status`).then(r => r.json()),
  ]);

  if (resp.source === "enqueued") {
    return {
      rawMarkdown: rawResp.content,
      rawHtml: rawResp.format === "html" ? rawResp.content : undefined,
      contentFormat: rawResp.format,
      content_source: "enqueued",
      summaryWordCount: 0,
      rawWordCount: 0,
      analysisStatus: "pending",
    };
  }

  if (resp.source === "error") {
    return {
      rawMarkdown: rawResp.content,
      rawHtml: rawResp.format === "html" ? rawResp.content : undefined,
      contentFormat: rawResp.format,
      serving_run_id: resp.serving_run_id,
      content_source: "error",
      summaryWordCount: 0,
      rawWordCount: 0,
      analysisStatus: statusResp.analysis_status ?? "none",
    };
  }

  return {
    markdown: resp.content,
    cards: resp.source === "analysis" && resp.cards ? resp.cards : undefined,
    article_meta: resp.article_meta,
    rawMarkdown: rawResp.content,
    rawHtml: rawResp.format === "html" ? rawResp.content : undefined,
    contentFormat: rawResp.format,
    serving_run_id: resp.serving_run_id,
    content_source: resp.source,
    summaryWordCount: resp.word_count ?? 0,
    rawWordCount: resp.raw_word_count ?? 0,
    analysisStatus: statusResp.analysis_status ?? "none",
  };
}

export function useArticles(accountId: number | null) {
  return useQuery({
    queryKey: ["articles", accountId ?? -1],
    queryFn: () => fetchArticleList(accountId ?? -1),
    staleTime: 5 * 60 * 1000,
    enabled: accountId !== null,
  });
}

export function useArticleContent(articleId: string | null) {
  return useQuery({
    queryKey: ["articleContent", articleId],
    queryFn: () => fetchArticleContent(articleId!),
    enabled: !!articleId,
    staleTime: Infinity,
  });
}

export function useAnalysisStatus(articleId: string | null, currentStatus: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["analysisStatus", articleId],
    queryFn: async () => {
      const resp = await apiFetch(`/articles/${articleId}/analysis-status`).then(r => r.json());
      const newStatus = resp.analysis_status;
      if (newStatus === "done") {
        queryClient.invalidateQueries({ queryKey: ["articleContent", articleId] });
        queryClient.invalidateQueries({ queryKey: ["articles"] });
      }
      return newStatus as string;
    },
    enabled: !!articleId && (currentStatus === "pending" || currentStatus === "running"),
    refetchInterval: 5000,
  });
}

export function useMarkRead(accountId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (articleId: string) => {
      await apiFetch(`/articles/${articleId}/read?status=1`, { method: "POST" });
    },
    onMutate: async (articleId) => {
      const key = ["articles", accountId ?? -1];
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<Article[]>(key, (old) =>
        old?.map(a => a.short_id === articleId ? { ...a, read_status: 1 } : a)
      );
    },
  });
}

export function useDismissArticle(accountId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (articleId: string) => {
      await apiFetch(`/articles/${articleId}/dismiss`, { method: "POST" });
    },
    onMutate: async (articleId) => {
      const key = ["articles", accountId ?? -1];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Article[]>(key);
      queryClient.setQueryData<Article[]>(key, (old) =>
        old?.map(a => a.short_id === articleId ? { ...a, dismissed: 1 } : a)
      );
      return { previous };
    },
    onError: (_err, _articleId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["articles", accountId ?? -1], context.previous);
      }
    },
  });
}
