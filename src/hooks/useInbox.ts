import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchInbox, fetchDiscarded, markAllCardsRead, apiFetch } from "../lib/api";
import type { InboxItem, DiscardedItem } from "../types";

export interface DateGroup<T = InboxItem> {
  key: "today" | "yesterday" | "thisWeek" | "lastWeek" | "older";
  label: string;
  items: T[];
}

export function useInbox(accountId?: number | null, unreadOnly?: boolean) {
  return useQuery<InboxItem[]>({
    queryKey: ["inbox", accountId ?? "all", unreadOnly ?? false],
    queryFn: async () => {
      const data = await fetchInbox(accountId, unreadOnly);
      return data.items ?? [];
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      const items = query.state.data;
      if (items?.some((item) => item.queue_status != null)) {
        return 10_000;
      }
      return false;
    },
  });
}

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
    mutationFn: async (cardId: string) => {
      await apiFetch(`/cards/${cardId}/read`, { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cardIds: string[]) => {
      await markAllCardsRead(cardIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
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

export function useGroupedInbox(accountId?: number | null, unreadOnly?: boolean) {
  const { data: items, ...rest } = useInbox(accountId, unreadOnly);
  const groups = useMemo(() => (items ? groupByDateBucket(items) : []), [items]);
  return { groups, items, ...rest };
}
