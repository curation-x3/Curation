import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { RotateCw } from "lucide-react";
import { stripFrontmatter, mdComponents } from "../../lib/markdown";
import { useCardContent } from "../../hooks/useCards";

interface Props {
  cardId: string;
}

export function CardContentView({ cardId }: Props) {
  const query = useCardContent(cardId, "source");

  if (query.isLoading) {
    return <div style={{ padding: 24, color: "var(--text-muted)", textAlign: "center" }}>加载中…</div>;
  }
  if (query.isError) {
    return (
      <div style={{ padding: 24, textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
        <div style={{ color: "var(--text-muted)" }}>卡片正文加载失败</div>
        <button type="button" onClick={() => query.refetch()} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", border: "1px solid var(--bg-panel)", background: "transparent", color: "var(--text-primary)", borderRadius: 4, cursor: "pointer" }}>
          <RotateCw size={14} /> 重试
        </button>
      </div>
    );
  }
  const md = query.data?.content;
  if (!md || md.trim() === "") {
    return <div style={{ padding: 24, color: "var(--text-muted)", textAlign: "center" }}>暂无卡片正文</div>;
  }

  return (
    <div style={{ padding: "0 16px" }}>
      <div className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={mdComponents}
        >
          {stripFrontmatter(md)}
        </ReactMarkdown>
      </div>
    </div>
  );
}
