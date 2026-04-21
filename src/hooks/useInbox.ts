import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchDiscarded, fetchQueue } from "../lib/api";
import type { InboxItem, DiscardedItem } from "../types";
import { getInboxCards, markCardRead, markCardUnread as markUnreadLocal, markAllCardsRead as markAllLocal, searchCards } from "../lib/cache";
import type { CachedCard, SearchResult } from "../lib/cache";

function cachedToInbox(c: CachedCard): InboxItem {
  const desc = c.description && c.description.trim().length > 0 ? c.description : c.digest;
  return {
    card_id: c.card_id,
    article_id: c.article_id,
    title: c.title ?? "",
    description: desc ?? null,
    routing: (c.routing as InboxItem["routing"]) ?? null,
    article_date: c.article_date,
    read_at: c.read_at,
    queue_status: null,
    article_meta: {
      title: c.article_title ?? c.title ?? "",
      account: c.account ?? "",
      account_id: c.account_id,
      author: c.author,
      publish_time: c.publish_time ?? c.article_date,
      url: c.url ?? "",
      cover_url: c.cover_url,
      digest: c.digest,
    },
  };
}

export interface DateGroup<T = InboxItem> {
  key: "today" | "yesterday" | "thisWeek" | "lastWeek" | "older";
  label: string;
  items: T[];
}

export function useInbox(accountId?: number | null, unreadOnly?: boolean) {
  return useQuery<InboxItem[]>({
    queryKey: ["inbox", "local", accountId ?? "all", unreadOnly ?? false],
    queryFn: async () => {
      const rows = await getInboxCards(null, unreadOnly ?? false);
      return rows.map(cachedToInbox);
    },
    staleTime: 0,
    refetchInterval: false,
  });
}

// Server-only for now: discarded items are excluded from /sync (see spec Q2).
// Localizing requires adding a discarded_items table + sync plumbing — low priority
// since this view is rarely opened and not part of the hot path.
export function useDiscarded() {
  return useQuery<DiscardedItem[]>({
    queryKey: ["discarded"],
    queryFn: async () => {
      const data = await fetchDiscarded();
      return data.items ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useMarkCardReadSingle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cardId: string) => markCardRead(cardId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox", "local"] });
    },
  });
}

export function useMarkCardUnread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cardId: string) => markUnreadLocal(cardId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox", "local"] });
    },
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cardIds: string[]) => markAllLocal(cardIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox", "local"] });
    },
  });
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day;
  const mon = new Date(d);
  mon.setDate(mon.getDate() + diff);
  return startOfDay(mon);
}

export function useIsFirstSync(syncing: boolean): boolean {
  const { data: items, isLoading } = useInbox();
  // Show banner while syncing and there are no items yet (empty DB or first load)
  return syncing && (isLoading || (items !== undefined && items.length === 0));
}

export function groupByDateBucket<T extends { article_date: string | null }>(items: T[]): DateGroup<T>[] {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisMonday = getMondayOfWeek(today);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(lastSunday.getDate() - 1);

  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, 2=Tue, ...
  const isMondayOrTuesday = dayOfWeek === 1 || dayOfWeek === 2;

  const buckets: Record<DateGroup["key"], T[]> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    lastWeek: [],
    older: [],
  };

  for (const item of items) {
    const dateStr = item.article_date;
    if (!dateStr) {
      buckets.older.push(item);
      continue;
    }
    const d = startOfDay(new Date(dateStr));
    const t = d.getTime();

    if (t === today.getTime()) {
      buckets.today.push(item);
    } else if (t === yesterday.getTime()) {
      buckets.yesterday.push(item);
    } else if (t >= thisMonday.getTime() && t < yesterday.getTime()) {
      if (isMondayOrTuesday) {
        // merge into yesterday
        buckets.yesterday.push(item);
      } else {
        buckets.thisWeek.push(item);
      }
    } else if (t >= lastMonday.getTime() && t <= lastSunday.getTime()) {
      buckets.lastWeek.push(item);
    } else {
      buckets.older.push(item);
    }
  }

  const labels: Record<DateGroup["key"], string> = {
    today: "今天",
    yesterday: "昨天",
    thisWeek: "本周",
    lastWeek: "上周",
    older: "更早",
  };

  const order: DateGroup["key"][] = ["today", "yesterday", "thisWeek", "lastWeek", "older"];

  return order
    .filter((key) => {
      if (isMondayOrTuesday && key === "thisWeek") return false;
      return buckets[key].length > 0;
    })
    .map((key) => ({
      key,
      label: labels[key],
      items: buckets[key],
    }));
}

interface AnalyzingQueueRow {
  article_id: string;
  article_title: string | null;
  article_account: string | null;
  article_publish_time: string | null;
  status: "pending" | "running" | "done" | "failed";
}

/**
 * Poll /queue for in-flight analysis entries. Returns InboxItem placeholders
 * (card_id === null) so the list can show a "分析中" spinner while the agent
 * pipeline runs — local cache only learns about the card once it's committed.
 */
export function useAnalyzingQueue(): InboxItem[] {
  const { data } = useQuery<AnalyzingQueueRow[]>({
    queryKey: ["queue", "analyzing"],
    queryFn: async () => {
      const rows = (await fetchQueue()) as AnalyzingQueueRow[];
      return rows.filter((r) => r.status === "pending" || r.status === "running");
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  return useMemo(() => {
    if (!data) return [];
    return data.map((q): InboxItem => ({
      card_id: null,
      article_id: q.article_id,
      title: q.article_title ?? "",
      description: null,
      routing: null,
      article_date: q.article_publish_time,
      read_at: null,
      queue_status: q.status === "pending" || q.status === "running" ? q.status : null,
      article_meta: {
        title: q.article_title ?? "",
        account: q.article_account ?? "",
        account_id: null,
        author: null,
        publish_time: q.article_publish_time,
        url: "",
      },
    }));
  }, [data]);
}

export function useInboxSearch(query: string) {
  const trimmed = query.trim();
  return useQuery<SearchResult[]>({
    queryKey: ["inbox-search", trimmed],
    enabled: trimmed.length >= 2,
    queryFn: () => searchCards(trimmed),
    staleTime: 30_000,
  });
}

export function useGroupedInbox(accountId?: number | null, unreadOnly?: boolean) {
  const { data: items, ...rest } = useInbox(accountId, unreadOnly);
  const groups = useMemo(() => (items ? groupByDateBucket(items) : []), [items]);
  return { groups, items, ...rest };
}
