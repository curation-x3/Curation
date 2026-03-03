import type { Article } from "../types";
import ArticleCard from "./ArticleCard";

interface ArticleFeedProps {
  articles: Article[];
  loading: boolean;
  onRefresh: () => void;
}

export default function ArticleFeed({
  articles,
  loading,
  onRefresh,
}: ArticleFeedProps) {
  return (
    <div className="feed-container">
      <div className="page-header">
        <div>
          <h2>Curated Feed</h2>
          <p>
            {articles.length > 0
              ? `${articles.length} articles ranked by relevance`
              : "Your AI-curated reading list"}
          </p>
        </div>
        {articles.length > 0 && (
          <button
            className="btn-primary"
            onClick={onRefresh}
            disabled={loading}
          >
            <span className={loading ? "spin" : ""}>⟳</span>
            Refresh
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading-state">
          <span className="loading-spinner">⟳</span>
          <p>Fetching and curating content…</p>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            This may take a moment while the AI analyzes articles
          </p>
        </div>
      ) : articles.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📭</span>
          <h3>No articles yet</h3>
          <p>
            Click <strong>Curate Now</strong> to fetch content from your sources
            and have the AI rank them by relevance.
          </p>
          <button className="btn-primary" onClick={onRefresh}>
            ⟳ Curate Now
          </button>
        </div>
      ) : (
        <div className="feed-list">
          {articles.map((article, i) => (
            <ArticleCard key={`${article.url}-${i}`} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
