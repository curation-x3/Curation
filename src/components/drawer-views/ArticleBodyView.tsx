import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ExternalLink, RotateCw } from "lucide-react";
import { mdComponents } from "../../lib/markdown";
import { useArticleContent } from "../../hooks/useArticles";
import { openExternal } from "../../lib/platform/url-opener";

interface Props {
  articleId: string;
}

export function ArticleBodyView({ articleId }: Props) {
  const query = useArticleContent(articleId);
  const data = query.data;
  const meta = data?.article_meta;
  const html = data?.rawHtml;
  const markdown = data?.rawMarkdown;
  const hasBody = (html && html.trim() !== "") || (markdown && markdown.trim() !== "");

  return (
    <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Metadata header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: "var(--fs-lg, 18px)", fontWeight: 600 }}>
          {meta?.title ?? (query.isLoading ? "加载中…" : "无标题")}
        </div>
        {(meta?.account || meta?.author || meta?.publish_time) && (
          <div style={{ fontSize: "var(--fs-sm, 13px)", color: "var(--text-muted)", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {meta?.account && <span>公众号：{meta.account}</span>}
            {meta?.author && meta.author !== meta.account && <span>作者：{meta.author}</span>}
            {meta?.publish_time && <span>{meta.publish_time}</span>}
          </div>
        )}
      </div>

      {/* Body — explicit three-state handling fixes bug #3 */}
      <div>
        {query.isLoading && (
          <div style={{ padding: 24, color: "var(--text-muted)", textAlign: "center" }}>
            正在拉取正文…
          </div>
        )}
        {query.isError && !query.isLoading && (
          <div style={{ padding: 24, textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
            <div style={{ color: "var(--text-muted)" }}>正文加载失败</div>
            <button
              type="button"
              onClick={() => query.refetch()}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", border: "1px solid var(--bg-panel)", background: "transparent", color: "var(--text-primary)", borderRadius: 4, cursor: "pointer" }}
            >
              <RotateCw size={14} /> 重试
            </button>
          </div>
        )}
        {!query.isLoading && !query.isError && !hasBody && (
          <div style={{ padding: 24, textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
            <div style={{ color: "var(--text-muted)" }}>暂无正文</div>
            <button
              type="button"
              onClick={() => query.refetch()}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", border: "1px solid var(--bg-panel)", background: "transparent", color: "var(--text-primary)", borderRadius: 4, cursor: "pointer" }}
            >
              <RotateCw size={14} /> 重试
            </button>
          </div>
        )}
        {!query.isLoading && !query.isError && hasBody && html && (
          <div className="article-html" dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {!query.isLoading && !query.isError && hasBody && !html && markdown && (
          <div className="prose prose-invert">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={mdComponents}
            >
              {markdown}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* Secondary action: open in external browser */}
      {meta?.url && (
        <div style={{ paddingTop: 12, borderTop: "1px solid var(--bg-panel)" }}>
          <button
            type="button"
            onClick={() => openExternal(meta.url)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", border: "1px solid var(--bg-panel)", background: "transparent", color: "var(--text-muted)", borderRadius: 4, cursor: "pointer", fontSize: "var(--fs-sm, 13px)" }}
          >
            <ExternalLink size={14} /> 在浏览器打开
          </button>
        </div>
      )}
    </div>
  );
}
