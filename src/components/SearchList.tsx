import { useEffect, useRef } from "react";
import { Search, X, Star, AlertCircle } from "lucide-react";
import type { SearchResult } from "../lib/cache";

interface SearchListProps {
  query: string;
  onQueryChange: (q: string) => void;
  results: SearchResult[];
  isLoading: boolean;
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  listWidth: number;
  semanticAvailable: boolean;
}

function formatDate(d: string | null) {
  if (!d) return "";
  return d.replace("T", " ").slice(0, 10);
}

export function SearchList({
  query,
  onQueryChange,
  results,
  isLoading,
  selectedCardId,
  onSelect,
  listWidth,
  semanticAvailable,
}: SearchListProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <section className="article-list-pane" style={{ width: listWidth }}>
      <header className="list-header" style={{ padding: "8px 10px", gap: 6, flexDirection: "row", alignItems: "center" }}>
        <div className="search-input-wrapper" style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
          <Search size={14} style={{ color: "var(--text-muted)", position: "absolute", left: 8, pointerEvents: "none" }} />
          <input
            ref={inputRef}
            className="search-input"
            placeholder="语义 + 关键词搜索..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            style={{ padding: "4px 28px 4px 28px", fontSize: "0.78rem", width: "100%" }}
          />
          {!semanticAvailable && query.length > 0 && (
            <AlertCircle
              size={12}
              style={{ color: "var(--text-muted)", marginRight: 4 }}
              aria-label="语义搜索暂不可用，当前为本地关键词模式"
            />
          )}
          {query && (
            <button
              onClick={() => onQueryChange("")}
              style={{
                position: "absolute", right: 4, background: "none", border: "none",
                cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex",
                alignItems: "center",
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", flexShrink: 0 }}>
          {query ? `${results.length} 条` : ""}
        </span>
      </header>

      <div className="list-content">
        {isLoading ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            搜索中...
          </div>
        ) : query && results.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            未找到匹配结果
          </div>
        ) : !query ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            输入关键词开始搜索
          </div>
        ) : (
          results.map((item) => (
            <div
              key={item.card_id}
              className={`inbox-item ${selectedCardId === item.card_id ? "selected" : ""}`}
              onClick={() => onSelect(item.card_id)}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
                {item.is_favorite && (
                  <Star size={13} style={{ color: "var(--accent-gold)", fill: "var(--accent-gold)", flexShrink: 0, marginTop: 2 }} />
                )}
                <span className="inbox-item-title" style={{ flex: 1 }}>
                  {item.title ?? "(无标题)"}
                </span>
              </div>
              {item.highlight && (
                <div
                  className="inbox-item-desc"
                  style={{ fontSize: "0.76rem", color: "var(--text-secondary)" }}
                  dangerouslySetInnerHTML={{ __html: item.highlight }}
                />
              )}
              <div className="inbox-item-meta">
                {item.account}
                {item.card_date && <> · {formatDate(item.card_date)}</>}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
