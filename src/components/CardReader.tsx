import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { BookOpen, Flag } from "lucide-react";
import { stripFrontmatter, mdComponents, CardHeader } from "../lib/markdown";
import { useMarkCardRead } from "../hooks/useCards";
import type { Card } from "../hooks/useCards";
import { FlagModal } from "./FlagModal";

interface CardReaderProps {
  card: (Card & { content?: string }) | null;
  onJumpToSource: (id: string) => void;
  onJumpToArticle: (articleId: string) => void;
  onSelectAccount: (accountId: number) => void;
  cardViewTab: "aggregated" | "source";
  cardViewDate: string | null;
  isAdmin?: boolean;
}

export function CardReader({ card, onJumpToSource, onJumpToArticle, onSelectAccount, cardViewTab, cardViewDate, isAdmin }: CardReaderProps) {
  const markCardRead = useMarkCardRead(cardViewDate, cardViewTab);
  const [flagging, setFlagging] = useState(false);
  const [flagSuccess, setFlagSuccess] = useState(false);

  useEffect(() => {
    setFlagging(false);
    setFlagSuccess(false);
  }, [card?.card_id]);

  if (!card) {
    return (
      <main className="reader-pane">
        <div className="reader-empty">
          <div className="reader-empty-icon"><BookOpen size={64} /></div>
          <h3>请选择一张卡片</h3>
        </div>
      </main>
    );
  }

  return (
    <main className="reader-pane">
      <div className="reader-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e6edf3' }}>
          {card.title}
        </span>
        {!card.read_at && (
          <button
            onClick={() => markCardRead.mutate(card.card_id)}
            style={{
              background: 'none', border: '1px solid #30363d', borderRadius: 4,
              color: '#8b949e', padding: '2px 10px', cursor: 'pointer', fontSize: '0.78rem',
            }}
          >
            标记已读
          </button>
        )}
      </div>
      {card.article_meta && <CardHeader meta={card.article_meta} onJumpToArticle={onJumpToArticle} onSelectAccount={onSelectAccount} />}
      <div className="reader-content animate-in">
        <div className="markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={mdComponents}
          >
            {stripFrontmatter(card.content || "")}
          </ReactMarkdown>
        </div>

        {/* Source tracing for aggregated cards */}
        {card.source_card_ids && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #30363d', fontSize: '0.82rem', color: '#8b949e' }}>
            <span>来源卡片：</span>
            {(() => {
              try {
                const ids = typeof card.source_card_ids === "string"
                  ? JSON.parse(card.source_card_ids)
                  : card.source_card_ids;
                return (ids as string[]).map((id: string) => (
                  <button
                    key={id}
                    onClick={() => onJumpToSource(id)}
                    style={{
                      marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer',
                      color: '#58a6ff', fontSize: '0.82rem', textDecoration: 'none',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                    onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                  >
                    {id.slice(0, 8)}...
                  </button>
                ));
              } catch {
                return null;
              }
            })()}
          </div>
        )}
      </div>
      {isAdmin && (
        <>
          <button
            onClick={() => setFlagging(true)}
            title="标记问题"
            style={{
              position: "fixed", bottom: 28, right: 28, zIndex: 100,
              width: 40, height: 40, borderRadius: "50%",
              background: flagSuccess ? "rgba(35,134,54,0.9)" : "rgba(22,27,34,0.9)",
              border: `1px solid ${flagSuccess ? "#3fb950" : "#30363d"}`,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "border-color 0.2s, background 0.2s",
            }}
          >
            <Flag size={16} color={flagSuccess ? "#3fb950" : "#f85149"} />
          </button>
          {flagging && card && (
            <FlagModal
              card={card}
              cardType={cardViewTab === "aggregated" ? "aggregated" : "source"}
              onClose={() => setFlagging(false)}
              onSuccess={() => {
                setFlagging(false);
                setFlagSuccess(true);
                setTimeout(() => setFlagSuccess(false), 1500);
              }}
            />
          )}
        </>
      )}
    </main>
  );
}
