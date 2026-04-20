import { useState, useMemo } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { InboxItem, DiscardedItem } from "../types";
import { groupByDateBucket } from "../hooks/useInbox";
import type { DateGroup } from "../hooks/useInbox";
import { useMarkAllRead } from "../hooks/useInbox";

interface InboxListProps {
  items: InboxItem[] | undefined;
  discardedItems?: DiscardedItem[];
  isDiscardedView: boolean;
  selectedId: string | null;
  onSelect: (id: string, type: "card" | "discarded") => void;
  isLoading: boolean;
  listWidth: number;
}

function routingTag(routing: "ai_curation" | "original_push") {
  if (routing === "ai_curation") {
    return <span className="inbox-tag tag-ai">AI总结</span>;
  }
  return <span className="inbox-tag tag-original">原文</span>;
}

function discardTag() {
  return <span className="inbox-tag tag-discard">丢弃</span>;
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
}: {
  group: DateGroup;
  isOpen: boolean;
  onToggle: () => void;
  onMarkAllRead: () => void;
}) {
  const unreadCount = group.items.filter((i) => !i.read_at).length;

  return (
    <div className="inbox-group-header" onClick={onToggle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ fontWeight: 600 }}>{group.label}</span>
        {unreadCount > 0 && (
          <span className="inbox-group-badge">{unreadCount}</span>
        )}
      </div>
      {unreadCount > 0 && (
        <button
          className="inbox-group-read-btn"
          onClick={(e) => {
            e.stopPropagation();
            onMarkAllRead();
          }}
          title="全部已读"
        >
          <Check size={12} /> 全部已读
        </button>
      )}
    </div>
  );
}

function InboxItemRow({
  item,
  isSelected,
  onSelect,
}: {
  item: InboxItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`inbox-item ${isSelected ? "selected" : ""} ${item.read_at ? "read" : ""}`}
      onClick={onSelect}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
        <span className="inbox-item-title" style={{ flex: 1 }}>{item.title}</span>
        {item.read_at && (
          <Check size={12} style={{ color: "#3fb950", flexShrink: 0, marginTop: 3 }} />
        )}
        {routingTag(item.routing)}
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

function DiscardedItemRow({
  item,
  isSelected,
  onSelect,
}: {
  item: DiscardedItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`inbox-item ${isSelected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span className="inbox-item-title">{item.title}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        {discardTag()}
      </div>
      <div className="inbox-item-desc">{item.routing_reason}</div>
      <div className="inbox-item-meta">
        {item.article_meta.account}
        {item.article_meta.publish_time && (
          <> · {formatTime(item.article_meta.publish_time)}</>
        )}
      </div>
    </div>
  );
}

export function InboxList({
  items,
  discardedItems,
  isDiscardedView,
  selectedId,
  onSelect,
  isLoading,
  listWidth,
}: InboxListProps) {
  const [search, setSearch] = useState("");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const markAllRead = useMarkAllRead();

  // Date groups for inbox items
  const groups = useMemo(() => {
    if (!items) return [];
    let filtered = items;
    if (showUnreadOnly) {
      filtered = filtered.filter((i) => !i.read_at);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.article_meta.account.toLowerCase().includes(q) ||
          (i.description && i.description.toLowerCase().includes(q))
      );
    }
    return groupByDateBucket(filtered);
  }, [items, showUnreadOnly, search]);

  // Filtered discarded items
  const filteredDiscarded = useMemo(() => {
    if (!discardedItems) return [];
    if (!search.trim()) return discardedItems;
    const q = search.trim().toLowerCase();
    return discardedItems.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.article_meta.account.toLowerCase().includes(q)
    );
  }, [discardedItems, search]);

  // Collapse state: default open for today/yesterday, conditionally for others
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function isGroupOpen(group: DateGroup) {
    if (group.key in collapsed) return !collapsed[group.key];
    // Defaults
    if (group.key === "today" || group.key === "yesterday") return true;
    if (group.key === "thisWeek" || group.key === "lastWeek") {
      return group.items.some((i) => !i.read_at);
    }
    return false; // older default collapsed
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleMarkGroupRead(group: DateGroup) {
    const unreadIds = group.items.filter((i) => !i.read_at).map((i) => i.card_id);
    if (unreadIds.length > 0) {
      markAllRead.mutate(unreadIds);
    }
  }

  function handleMarkAllRead() {
    if (!items) return;
    const unreadIds = items.filter((i) => !i.read_at).map((i) => i.card_id);
    if (unreadIds.length > 0) {
      markAllRead.mutate(unreadIds);
    }
  }

  const totalUnread = items?.filter((i) => !i.read_at).length ?? 0;

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
            style={{ padding: "4px 8px", fontSize: "0.78rem" }}
          />
        </div>
        <div className="view-toggle" style={{ padding: 0, fontSize: "0.7rem" }}>
          <button
            className={`view-toggle-btn ${!showUnreadOnly ? "active" : ""}`}
            onClick={() => setShowUnreadOnly(false)}
            style={{ padding: "2px 8px", fontSize: "0.7rem" }}
          >
            全部
          </button>
          <button
            className={`view-toggle-btn ${showUnreadOnly ? "active" : ""}`}
            onClick={() => setShowUnreadOnly(true)}
            style={{ padding: "2px 8px", fontSize: "0.7rem" }}
          >
            未读
          </button>
        </div>
        {!isDiscardedView && (
          <button
            className="inbox-group-read-btn"
            onClick={handleMarkAllRead}
            title="全部已读"
            style={{ whiteSpace: "nowrap", opacity: 1, padding: "2px 6px", fontSize: "0.68rem" }}
            disabled={totalUnread === 0}
          >
            <Check size={10} />
          </button>
        )}
      </header>

      {/* List content */}
      <div className="list-content">
        {isLoading ? (
          <div style={{ padding: 20, textAlign: "center", color: "#8b949e", fontSize: "0.85rem" }}>
            加载中...
          </div>
        ) : isDiscardedView ? (
          /* Discarded view: flat list */
          filteredDiscarded.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#8b949e", fontSize: "0.85rem" }}>
              暂无丢弃文章
            </div>
          ) : (
            filteredDiscarded.map((item) => (
              <DiscardedItemRow
                key={item.article_id}
                item={item}
                isSelected={selectedId === item.article_id}
                onSelect={() => onSelect(item.article_id, "discarded")}
              />
            ))
          )
        ) : (
          /* Inbox view: grouped by date */
          groups.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#8b949e", fontSize: "0.85rem" }}>
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
                />
                {isGroupOpen(group) &&
                  group.items.map((item) => (
                    <InboxItemRow
                      key={item.card_id}
                      item={item}
                      isSelected={selectedId === item.card_id}
                      onSelect={() => onSelect(item.card_id, "card")}
                    />
                  ))}
              </div>
            ))
          )
        )}
      </div>
    </section>
  );
}
