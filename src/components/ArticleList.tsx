import { useState } from "react";
import { X, Check } from "lucide-react";
import { useMarkRead, useDismissArticle, fetchArticleContent } from "../hooks/useArticles";
import { usePrefetchOnVisible, usePrefetchAdjacent } from "../hooks/usePrefetchOnVisible";
import type { Article } from "../types";

function ArticleListItem({ article, children }: { article: Article; children: React.ReactNode }) {
  const ref = usePrefetchOnVisible(
    ["articleContent", article.short_id],
    () => fetchArticleContent(article.short_id),
  );
  return <div ref={ref}>{children}</div>;
}

interface ArticleListProps {
  articles: Article[];
  selectedArticleId: string | null;
  onSelectArticle: (id: string) => void;
  onSelectAccount: (id: number) => void;
  accountId: number | null;
  listWidth: number;
}

export function ArticleList({
  articles, selectedArticleId, onSelectArticle, onSelectAccount, accountId, listWidth,
}: ArticleListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"unprocessed" | "all">("unprocessed");
  const [hidingArticleId, setHidingArticleId] = useState<string | null>(null);

  const markRead = useMarkRead();
  const dismissArticle = useDismissArticle();

  const handleMarkRead = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    markRead.mutate(id);
  };

  const handleDismissArticle = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setHidingArticleId(id);
    dismissArticle.mutate(id);
  };

  const filteredArticles = articles
    .filter(a => a.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter(a => viewMode === 'all' || (!a.read_status && !a.dismissed));

  // Prefetch adjacent articles when selection changes
  usePrefetchAdjacent(
    filteredArticles.map(a => ({ id: a.short_id })),
    selectedArticleId,
    (id) => ({
      queryKey: ["articleContent", id],
      queryFn: () => fetchArticleContent(id),
    }),
  );

  return (
    <section className="article-list-pane" style={{ width: listWidth }}>
      <header className="list-header">
        <div className="search-input-wrapper">
          <input
            type="text"
            className="search-input"
            placeholder="搜索文章标题..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'unprocessed' ? 'active' : ''}`}
            onClick={() => setViewMode('unprocessed')}
          >未读</button>
          <button
            className={`view-toggle-btn ${viewMode === 'all' ? 'active' : ''}`}
            onClick={() => setViewMode('all')}
          >全部</button>
        </div>
      </header>
      <div className="list-content">
        {(() => {
          let lastDate = '';
          return filteredArticles.map(art => {
            const dateStr = (art.publish_time || '').split(' ')[0] || '';
            const showSeparator = dateStr && dateStr !== lastDate;
            if (dateStr) lastDate = dateStr;
            return (
              <ArticleListItem key={art.short_id} article={art}>
                {showSeparator && <div className="date-separator">{dateStr}</div>}
                <div
                  className={`article-card-wrapper ${hidingArticleId === art.short_id && viewMode === 'unprocessed' ? 'hiding' : ''}`}
                  onTransitionEnd={(e) => {
                    if (e.propertyName === 'max-height' && hidingArticleId === art.short_id) {
                      setHidingArticleId(null);
                    }
                  }}
                >
                  <div
                    className={`article-card ${selectedArticleId === art.short_id ? 'active' : ''}`}
                    onClick={() => onSelectArticle(art.short_id)}
                  >
                    <div className="article-card-left">
                      <div className={`article-card-title ${art.read_status ? 'read' : ''}`}>{art.title}</div>
                      {art.digest && <div className="article-card-digest">{art.digest}</div>}
                      <div className="article-card-meta">
                        {art.publish_time}{art.word_count ? ` · 约${art.word_count}字 · 阅读约${Math.max(1, Math.round(art.word_count / 400))}分钟` : ''}{art.account && <> · <span
                          onClick={e => { e.stopPropagation(); if (art.account_id) onSelectAccount(art.account_id); }}
                          style={{ cursor: 'pointer', color: 'var(--primary-color)', textDecoration: 'none' }}
                          onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                          onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                        >{art.account}</span></>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                      {art.cover_url && (
                        <img src={art.cover_url} alt="Cover" className="article-card-thumb" referrerPolicy="no-referrer" />
                      )}
                      {!art.read_status && (
                        <button className="btn-icon" title="标记已读" onClick={(e) => handleMarkRead(e, art.short_id)}
                          style={{ color: '#8b949e' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#3fb950')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#8b949e')}>
                          <Check size={14} />
                        </button>
                      )}
                      <button className="btn-icon dismiss-btn" onClick={(e) => handleDismissArticle(e, art.short_id)}>
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </ArticleListItem>
            );
          });
        })()}
      </div>
    </section>
  );
}
