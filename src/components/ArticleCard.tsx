import type { Article } from "../types";

interface ArticleCardProps {
  article: Article;
}

function scoreClass(score: number): string {
  if (score >= 7) return "score-high";
  if (score >= 4) return "score-mid";
  return "score-low";
}

function formatDate(published: string): string {
  if (!published) return "";
  try {
    return new Date(published).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return published;
  }
}

function sourceName(source: string): string {
  try {
    const url = new URL(source);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return source;
  }
}

export default function ArticleCard({ article }: ArticleCardProps) {
  return (
    <article className="article-card">
      <div className="article-card-header">
        <h3 className="article-title">
          <a href={article.url} target="_blank" rel="noopener noreferrer">
            {article.title}
          </a>
        </h3>
        <div className={`score-badge ${scoreClass(article.score)}`}>
          {article.score.toFixed(1)}
          <span>score</span>
        </div>
      </div>

      <div className="article-meta">
        <span className="article-source">{sourceName(article.source)}</span>
        {article.published && (
          <span className="article-date">{formatDate(article.published)}</span>
        )}
      </div>

      {article.summary && (
        <p className="article-summary">{article.summary}</p>
      )}

      {article.reason && (
        <div className="article-reason">
          <span className="reason-label">AI: </span>
          <span>{article.reason}</span>
        </div>
      )}
    </article>
  );
}
