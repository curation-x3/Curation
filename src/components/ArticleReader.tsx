import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ExternalLink, FileText, Sparkles } from "lucide-react";
import type { Article } from "../types";
import type { ArticleContent } from "../hooks/useArticles";
import { stripFrontmatter, mdComponents, CardHeader } from "../lib/markdown";

interface ArticleReaderProps {
  article: Article & Partial<ArticleContent>;
  analysisStatus: string;
  viewRaw: boolean;
  onViewRawChange: (v: boolean) => void;
  isContentLoading?: boolean;
}

export function ArticleReader({ article, analysisStatus, viewRaw, onViewRawChange, isContentLoading }: ArticleReaderProps) {
  const summaryWordCount = article.summaryWordCount ?? 0;
  const rawWordCount = article.rawWordCount ?? 0;

  if (isContentLoading) return (
    <div style={{padding:'2rem',textAlign:'center',color:'#8b949e'}}>加载文章内容...</div>
  );

  return (
    <>
      <div className="reader-toolbar">
        {/* View mode segmented control */}
        <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid #30363d', marginRight: 'auto' }}>
          <button
            onClick={() => onViewRawChange(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: '0.75rem', padding: '5px 12px',
              border: 'none', cursor: 'pointer',
              background: viewRaw ? '#3b82f6' : '#21262d',
              color: viewRaw ? '#fff' : '#8b949e',
              transition: 'background 0.15s',
            }}
          >
            <FileText size={13} />
            原文
          </button>
          <button
            onClick={() => onViewRawChange(false)}
            disabled={article.content_source !== "analysis" && analysisStatus !== "pending" && analysisStatus !== "running"}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: '0.75rem', padding: '5px 12px',
              border: 'none',
              cursor: article.content_source === "analysis" ? 'pointer' : 'default',
              background: !viewRaw ? '#3b82f6' : '#21262d',
              color: (!viewRaw ? '#fff' : (analysisStatus === "none" || analysisStatus === "failed") ? '#4b5563' : '#8b949e'),
              transition: 'background 0.15s',
            }}
          >
            <Sparkles size={13} />
            深度总结
          </button>
        </div>
        <button className="btn-icon" title="打开原文" onClick={() => window.open(article.url)}>
          <ExternalLink size={18} />
        </button>
      </div>
      {/* Word count info bar */}
      {article.content_source === "analysis" && summaryWordCount > 0 && rawWordCount > 0 && (
        <div style={{
          padding: '6px 16px', fontSize: '0.78rem', color: '#8b949e',
          background: '#161b22', borderBottom: '1px solid #21262d',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>全文约{summaryWordCount}字 · 阅读约{Math.max(1, Math.round(summaryWordCount / 400))}分钟（原文约{rawWordCount}字）</span>
          {summaryWordCount / rawWordCount > 0.7 && (
            <span style={{ color: '#d29922', marginLeft: 4 }}>
              — AI 认为这是一篇值得完整阅读的文章
            </span>
          )}
        </div>
      )}
      {article.content_source !== "analysis" && rawWordCount > 0 && viewRaw && (
        <div style={{
          padding: '6px 16px', fontSize: '0.78rem', color: '#8b949e',
          background: '#161b22', borderBottom: '1px solid #21262d',
        }}>
          全文约{rawWordCount}字 · 阅读约{Math.max(1, Math.round(rawWordCount / 400))}分钟
        </div>
      )}
      <div className="reader-content animate-in">
        {article.content_source === "not_loaded" ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: '#8b949e' }}>
            <Sparkles size={32} style={{ opacity: 0.4 }} className="animate-spin" />
            <span style={{ fontSize: '0.9rem' }}>正在加载文章内容...</span>
          </div>
        ) : !viewRaw && (analysisStatus === "pending" || analysisStatus === "running") ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: '#8b949e' }}>
            <Sparkles size={32} style={{ opacity: 0.4 }} className="animate-spin" />
            <span style={{ fontSize: '0.9rem' }}>正在生成 AI 总结...</span>
          </div>
        ) : (
          <>
            <div className="markdown-body">
              {viewRaw && article.contentFormat === "html" ? (
                <div
                  className="rich-text-content"
                  dangerouslySetInnerHTML={{ __html: article.rawMarkdown || "" }}
                />
              ) : !viewRaw && article.cards && article.cards.length > 0 ? (
                <>
                  {/* Article meta header - once */}
                  {article.article_meta && <CardHeader meta={article.article_meta} />}

                  {/* Card list */}
                  {article.cards.map((card) => (
                    <div key={card.card_id} className="mb-6 border border-gray-200 rounded-lg p-4" style={{ marginBottom: 24, border: '1px solid #30363d', borderRadius: 8, padding: 16 }}>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>{card.title}</h3>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={mdComponents}
                      >
                        {stripFrontmatter(card.content)}
                      </ReactMarkdown>
                    </div>
                  ))}

                  {/* Unpushed content at bottom */}
                  {(() => {
                    const unpushedItems: { topic: string; reason: string }[] = [];
                    for (const card of article.cards!) {
                      if (!card.unpushed) continue;
                      try {
                        const parsed = typeof card.unpushed === "string"
                          ? JSON.parse(card.unpushed)
                          : card.unpushed;
                        if (Array.isArray(parsed)) unpushedItems.push(...parsed);
                      } catch { /* ignore */ }
                    }
                    if (unpushedItems.length === 0) return null;
                    return (
                      <div style={{ padding: '20px', borderTop: '2px solid #21262d' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>未推送内容</div>
                        {unpushedItems.map((item, i) => (
                          <div key={i} style={{ marginBottom: 14, paddingLeft: 12, borderLeft: '2px solid #30363d' }}>
                            <div style={{ color: '#c9d1d9', fontWeight: 500, marginBottom: 4, fontSize: '0.82rem' }}>{item.topic}</div>
                            <div style={{ color: '#6b7280', lineHeight: 1.6, fontSize: '0.82rem' }}>{item.reason}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={mdComponents}
                >
                  {(viewRaw ? article.rawMarkdown : article.markdown) || ""}
                </ReactMarkdown>
              )}
            </div>

            {/* Metadata Inspector */}
            <div className="metadata-inspector">
              <h4>元数据详情</h4>
              <div className="meta-grid">
                <div className="meta-item"><label>HashID</label><span>{article.hashid || '-'}</span></div>
                <div className="meta-item"><label>Idx</label><span>{article.idx || '-'}</span></div>
                <div className="meta-item"><label>IP 归属</label><span>{article.ip_wording || '-'}</span></div>
                <div className="meta-item"><label>原创</label><span>{article.is_original ? '是' : '否'}</span></div>
                <div className="meta-item"><label>送达人数</label><span>{article.send_to_fans_num || '-'}</span></div>
                <div className="meta-item"><label>发布时间</label><span>{article.publish_time}</span></div>
                <div className="meta-item"><label>创建时间</label><span>{article.create_time || '-'}</span></div>
                <div className="meta-item"><label>用户码 (Alias)</label><span>{article.alias || '-'}</span></div>
                <div className="meta-item"><label>ID (UserName)</label><span>{article.user_name || '-'}</span></div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
