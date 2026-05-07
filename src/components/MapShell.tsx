import { useEffect, useMemo, useState } from "react";
import { MapCanvas } from "../map/components/MapCanvas";
import { MapTabBar, resolveTabDate, type DateTab } from "./MapTabBar";
import { MapEmptyState } from "./MapEmptyState";
import { useMapCards } from "../hooks/useMap";
import { useArticleContent } from "../hooks/useArticles";
import { useMarkCardReadSingle, useInbox } from "../hooks/useInbox";
import { useMapStore } from "../map/state/store";
import type { InboxItem } from "../types";
import type { MapDSL } from "../map/types";
import type { ArticleContent } from "../map/types";

const READINESS_THRESHOLD = 0.8;

function buildDsl(cards: InboxItem[]): MapDSL {
  const domainsMap = new Map<string, { id: string; label: string; latin_label?: string; display_order: number }>();
  const topicsMap = new Map<string, { id: string; domain_id: string; label: string; display_order: number }>();
  let domainOrder = 0;
  let topicOrder = 0;
  for (const c of cards) {
    if (!c.topic) continue;
    const t = c.topic;
    if (!domainsMap.has(t.domain_id)) {
      domainsMap.set(t.domain_id, {
        id: t.domain_id,
        label: t.domain_label,
        latin_label: t.domain_latin_label ?? undefined,
        display_order: domainOrder++,
      });
    }
    if (!topicsMap.has(t.id)) {
      topicsMap.set(t.id, {
        id: t.id,
        domain_id: t.domain_id,
        label: t.label,
        display_order: topicOrder++,
      });
    }
  }
  return { domains: Array.from(domainsMap.values()), topics: Array.from(topicsMap.values()) };
}

function isDayReady(cards: InboxItem[]): boolean {
  if (cards.length === 0) return false;
  const tagged = cards.filter(
    (c) => (c.entities?.length ?? 0) > 0 && c.topic != null,
  );
  return tagged.length / cards.length >= READINESS_THRESHOLD;
}

export function MapShell() {
  const [tab, setTab] = useState<DateTab>({ kind: "yesterday" });
  const date = useMemo(() => resolveTabDate(tab), [tab]);

  const cards = useMapCards(date);
  const markRead = useMarkCardReadSingle();
  const inbox = useInbox();

  const dsl = useMemo(() => buildDsl(cards.data ?? []), [cards.data]);

  // Index cards by card_id for the article-content adapter below.
  const cardById = useMemo(() => {
    const m = new Map<string, InboxItem>();
    for (const c of cards.data ?? []) {
      if (c.card_id) m.set(c.card_id, c);
    }
    return m;
  }, [cards.data]);

  // Adapter: MapCanvas expects useArticleContent(card_id), but our app hook
  // takes article_id. Translate by looking up the card's article_id and
  // reshape the response into the map ArticleContent type.
  const useMapArticleContent = (cardId: string | null) => {
    const card = cardId ? cardById.get(cardId) ?? null : null;
    const articleId = card?.article_id ?? null;
    const q = useArticleContent(articleId);
    const data: ArticleContent | null = useMemo(() => {
      if (!q.data || !card) return null;
      const meta = (card as any).article_meta ?? {};
      // useArticleContent returns ArticleContent from useArticles.ts which has
      // rawMarkdown as the primary body field (raw article markdown).
      const rawHtml = typeof (q.data as any).rawHtml === "string" ? (q.data as any).rawHtml : undefined;
      const rawMarkdown =
        typeof (q.data as any).rawMarkdown === "string"
          ? (q.data as any).rawMarkdown
          : typeof (q.data as any).markdown === "string"
            ? (q.data as any).markdown
            : undefined;
      const body = rawMarkdown ?? rawHtml ?? "";
      return {
        id: card.card_id ?? card.article_id ?? "",
        title: card.title ?? meta.title ?? "",
        account: meta.account ?? "",
        publish_time: meta.publish_time ?? "",
        content_md: typeof body === "string" ? body : "",
        rawHtml,
        rawMarkdown,
      };
    }, [q.data, card]);
    return { data, isLoading: q.isLoading };
  };

  // Earliest selectable date for the picker = oldest card_date in inbox cache.
  const earliest = useMemo(() => {
    if (!inbox.data || inbox.data.length === 0) return undefined;
    return inbox.data
      .map((i) => i.card_date)
      .filter((d): d is string => !!d)
      .sort()[0];
  }, [inbox.data]);

  // Reset map internal state when shell unmounts (user switches view).
  useEffect(
    () => () => {
      useMapStore.setState({ drawer_card_id: null, hovered_card_id: null });
    },
    [],
  );

  const ready = useMemo(() => isDayReady(cards.data ?? []), [cards.data]);

  return (
    <div className="map-shell" data-map-theme="dark">
      <MapTabBar value={tab} onChange={setTab} earliest={earliest} />
      {cards.isError ? (
        <div className="map-error">该日数据加载失败</div>
      ) : cards.isLoading ? (
        <div className="map-loading">加载中…</div>
      ) : dsl.domains.length === 0 ? (
        <MapEmptyState date={date} variant="no_taxonomy" />
      ) : !ready ? (
        <MapEmptyState
          date={date}
          variant={(cards.data?.length ?? 0) === 0 ? "no_cards" : "not_ready"}
        />
      ) : (
        <MapCanvas
          dsl={dsl}
          cards={cards.data ?? []}
          useArticleContent={useMapArticleContent}
          onMarkRead={(id: string) => markRead.mutate(id)}
        />
      )}
    </div>
  );
}
