import { useState, useMemo, useCallback, useDeferredValue } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Star } from "lucide-react";
import type { InboxItem } from "../types";
import { groupByDateBucket, useInboxSearch } from "../hooks/useInbox";
import type { DateGroup } from "../hooks/useInbox";
import { useMarkAllRead, useMarkCardUnread } from "../hooks/useInbox";
import type { SearchResult } from "../lib/cache";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

interface InboxListProps {
  items: InboxItem[] | undefined;
  isDiscardedView: boolean;
  selectedId: string | null;
  onSelect: (id: string, type: "card" | "discarded") => void;
  isLoading: boolean;
  listWidth: number;
  favoriteCardIds?: Set<string>;
  isFirstSync?: boolean;
}

function routingTag(routing: "ai_curation" | "original_push" | null, queueStatus?: "pending" | "running" | null, isDiscarded?: boolean) {
  if (queueStatus) {
    return (
      <span className="inbox-tag" style={{ background: "var(--accent-blue-dim)", color: "var(--accent-blue)", display: "inline-flex", alignItems: "center", gap: 3 }}>
        <Loader2 size={10} className="animate-spin" />
        分析中
      </span>
    );
  }
  if (isDiscarded) {
    return <span className="inbox-tag" style={{ color: "var(--accent-red)" }}>丢弃</span>;
  }
  if (routing === "ai_curation") {
    return <span className="inbox-tag" style={{ color: "var(--accent-blue)" }}>AI总结</span>;
  }
  if (routing === "original_push") {
    return <span className="inbox-tag" style={{ color: "var(--accent-green)" }}>原文</span>;
  }
  return null;
}

function formatTime(t: string | null) {
  if (!t) return "";
  return t.replace("T", " ").slice(0, 16);
}

function InboxGroupHeader({
  group,
  isOpen,
  onToggle,
  onMarkAllRead,
  onMarkAllUnread,
}: {
  group: DateGroup;
  isOpen: boolean;
  onToggle: () => void;
  onMarkAllRead: () => void;
  onMarkAllUnread: () => void;
}) {
  const unreadCount = group.items.filter((i) => !i.read_at).length;
  const allRead = unreadCount === 0;

  return (
    <div className="inbox-group-header" onClick={onToggle}>
      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      <span>{group.label}</span>
      {unreadCount > 0 && (
        <span className="inbox-group-badge">{unreadCount}</span>
      )}
      <div style={{ flex: 1 }} />
      <button
        className="inbox-group-read-btn"
        onClick={(e) => {
          e.stopPropagation();
          allRead ? onMarkAllUnread() : onMarkAllRead();
        }}
      >
        <Check size={12} /> {allRead ? "全部未读" : "全部已读"}
      </button>
    </div>
  );
}

function InboxItemRow({
  item,
  isSelected,
  isFavorite,
  isDiscarded,
  onSelect,
  onContextMenu,
}: {
  item: InboxItem;
  isSelected: boolean;
  isFavorite: boolean;
  isDiscarded?: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const isAnalyzing = !!item.queue_status;
  return (
    <div
      className={`inbox-item ${isSelected ? "selected" : ""} ${!isAnalyzing && item.read_at ? "read" : ""}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
        {isFavorite && (
          <Star size={13} style={{ color: "var(--accent-gold)", fill: "var(--accent-gold)", flexShrink: 0, marginTop: 3 }} />
        )}
        <span className="inbox-item-title" style={{ flex: 1 }}>{item.title}</span>
        {routingTag(item.routing, item.queue_status, isDiscarded)}
      </div>
      {item.description && (
        <div className="inbox-item-desc">{item.description}</div>
      )}
      <div className="inbox-item-meta">
        {item.article_meta.account}
        {item.article_meta.publish_time && (
          <> · {formatTime(item.article_meta.publish_time)}</>
        )}
      </div>
    </div>
  );
}


function searchResultToInbox(h: SearchResult): InboxItem {
  return {
    card_id: h.card_id,
    article_id: h.article_id,
    title: h.title ?? "",
    description: h.highlight,
    routing: null,
    article_date: h.article_date,
    read_at: null,
    queue_status: null,
    article_meta: {
      title: h.title ?? "",
      account: h.account ?? "",
      account_id: null,
      author: null,
      publish_time: null,
      url: "",
    },
  };
}

export function InboxList({
  items,
  isDiscardedView,
  selectedId,
  onSelect,
  isLoading,
  listWidth,
  favoriteCardIds = new Set(),
  isFirstSync = false,
}: InboxListProps) {
  const [search, setSearch] = useState("");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const markAllRead = useMarkAllRead();
  const markUnread = useMarkCardUnread();
  const deferredSearch = useDeferredValue(search);
  const isSearching = deferredSearch.trim().length >= 2;
  const { data: searchHits } = useInboxSearch(isSearching ? deferredSearch : "");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const showItemContextMenu = useCallback((e: React.MouseEvent, item: InboxItem) => {
    e.preventDefault();
    const menuItems: ContextMenuItem[] = [];
    if (item.read_at && item.card_id) {
      menuItems.push({ label: "标为未读", onClick: () => markUnread.mutate(item.card_id!) });
    }
    if (menuItems.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
    }
  }, [markUnread]);

  // Date groups for inbox items (search mode uses FTS, not this memo)
  const groups = useMemo(() => {
    if (!items) return [];
    let filtered = items;
    if (showUnreadOnly) {
      filtered = filtered.filter((i) => !i.read_at);
    }
    return groupByDateBucket(filtered);
  }, [items, showUnreadOnly]);

  // Collapse state: default open for today/yesterday, conditionally for others
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function isGroupOpen(group: DateGroup<InboxItem>) {
    if (group.key in collapsed) return !collapsed[group.key];
    // Defaults
    if (group.key === "today" || group.key === "yesterday") return true;
    if (group.key === "thisWeek" || group.key === "lastWeek") {
      if ("items" in group && group.items.length > 0 && "read_at" in group.items[0]) {
        return (group.items as InboxItem[]).some((i) => !i.read_at);
      }
      return true;
    }
    return false; // older default collapsed
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleMarkGroupRead(group: DateGroup) {
    const unreadIds = group.items
      .filter((i) => !i.read_at && i.card_id)
      .map((i) => i.card_id as string);
    if (unreadIds.length > 0) {
      markAllRead.mutate(unreadIds);
    }
  }

  function handleMarkGroupUnread(group: DateGroup) {
    const readIds = group.items
      .filter((i) => i.read_at && i.card_id)
      .map((i) => i.card_id as string);
    for (const id of readIds) {
      markUnread.mutate(id);
    }
  }


  return (
    <section className="article-list-pane" style={{ width: listWidth }}>
      {/* Search + toggles — all on one row */}
      <header className="list-header" style={{ padding: "8px 10px", gap: 6, flexDirection: "row", alignItems: "center" }}>
        <div className="search-input-wrapper" style={{ flex: 1 }}>
          <input
            className="search-input"
            placeholder="搜索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "4px 8px" }}
          />
        </div>
        <div className="view-toggle" style={{ padding: 0 }}>
          <button
            className={`view-toggle-btn ${!showUnreadOnly ? "active" : ""}`}
            onClick={() => setShowUnreadOnly(false)}
            style={{ padding: "2px 8px" }}
          >
            全部
          </button>
          <button
            className={`view-toggle-btn ${showUnreadOnly ? "active" : ""}`}
            onClick={() => setShowUnreadOnly(true)}
            style={{ padding: "2px 8px" }}
          >
            未读
          </button>
        </div>
      </header>

      {/* List content */}
      <div className="list-content">
        {isFirstSync && (
          <div className="sync-banner">首次同步中…内容会陆续出现。</div>
        )}
        {isSearching ? (
          searchHits === undefined ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: "var(--fs-base)" }}>
              搜索中…
            </div>
          ) : searchHits.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: "var(--fs-base)" }}>
              无匹配结果
            </div>
          ) : (
            searchHits.map((h) => {
              const item = searchResultToInbox(h);
              return (
                <InboxItemRow
                  key={h.card_id}
                  item={item}
                  isSelected={selectedId === h.card_id}
                  isFavorite={h.is_favorite || favoriteCardIds.has(h.card_id)}
                  isDiscarded={false}
                  onSelect={() => onSelect(h.card_id, "card")}
                  onContextMenu={(e) => e.preventDefault()}
                />
              );
            })
          )
        ) : isLoading ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: "var(--fs-base)" }}>
            加载中...
          </div>
        ) : groups.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: "var(--fs-base)" }}>
              {showUnreadOnly ? "没有未读内容" : "暂无内容"}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.key}>
                <InboxGroupHeader
                  group={group}
                  isOpen={isGroupOpen(group)}
                  onToggle={() => toggleGroup(group.key)}
                  onMarkAllRead={() => handleMarkGroupRead(group)}
                  onMarkAllUnread={() => handleMarkGroupUnread(group)}
                />
                {isGroupOpen(group) &&
                  group.items.map((item) => (
                    <InboxItemRow
                      key={item.card_id ?? `analyzing:${item.article_id}`}
                      item={item}
                      isSelected={
                        item.card_id
                          ? selectedId === item.card_id
                          : selectedId === item.article_id
                      }
                      isFavorite={!!item.card_id && favoriteCardIds.has(item.card_id)}
                      isDiscarded={isDiscardedView}
                      onSelect={() =>
                        onSelect(item.card_id ?? item.article_id, isDiscardedView ? "discarded" : "card")
                      }
                      onContextMenu={(e) => showItemContextMenu(e, item)}
                    />
                  ))}
              </div>
            ))
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}
