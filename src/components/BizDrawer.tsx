import { useState } from "react";
import { X, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { fmtTime, statusLabel, routingPill } from "../lib/tableHelpers";
import { useBizArticles } from "../hooks/useBizArticles";
import { ArticlePreviewDrawer } from "./ArticlePreviewDrawer";
import type { BizSummary } from "../hooks/useAdminSubscriptions";

type Tab = "articles" | "subscribers";

interface Props {
  biz: BizSummary | null;
  includeEnded: boolean;
  onClose: () => void;
}

export function BizDrawer({ biz, includeEnded, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("articles");
  const [previewArticleId, setPreviewArticleId] = useState<string | null>(null);
  const [previewRouting, setPreviewRouting] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: articles = [], isLoading } = useBizArticles(biz?.biz ?? null);

  if (!biz) return null;

  const closeWindow = async (id: number) => {
    await apiFetch(`/api/admin/subscriptions/windows/${id}/close`, { method: "POST" });
    qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
  };
  const deleteWindow = async (id: number) => {
    if (!confirm("删除此订阅记录？")) return;
    await apiFetch(`/api/admin/subscriptions/windows/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
  };

  const subscribers = (biz.subscribers || []).filter(
    s => includeEnded || !s.ended_at,
  );

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 150 }}
           onClick={onClose}>
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 560,
                      maxWidth: "90vw", background: "var(--bg-base)",
                      borderLeft: "1px solid var(--border)",
                      display: "flex", flexDirection: "column" }}
             onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", gap: 10,
                        padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            {biz.avatar_url && (
              <img src={biz.avatar_url} alt="" referrerPolicy="no-referrer"
                   style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "var(--text-primary)", fontSize: "var(--fs-md)", fontWeight: 600 }}>
                {biz.name || biz.biz}
              </div>
              <div style={{ color: "var(--text-faint)", fontSize: "var(--fs-xs)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                biz: {biz.biz}
              </div>
            </div>
            <button onClick={onClose}
                    style={{ background: "none", border: "none", color: "var(--text-muted)",
                             cursor: "pointer" }}>
              <X size={18} />
            </button>
          </div>

          <div style={{ display: "flex", gap: 12, padding: "0 16px",
                        borderBottom: "1px solid var(--border)" }}>
            <TabBtn active={tab === "articles"} onClick={() => setTab("articles")}>
              文章列表
            </TabBtn>
            <TabBtn active={tab === "subscribers"} onClick={() => setTab("subscribers")}>
              订阅者 ({subscribers.length})
            </TabBtn>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {tab === "articles" && (
              <ArticleTab
                loading={isLoading}
                articles={articles}
                onArticleClick={(id, routing) => {
                  setPreviewArticleId(id);
                  setPreviewRouting(routing);
                }}
              />
            )}
            {tab === "subscribers" && (
              <SubscriberTab
                subscribers={subscribers}
                onClose={closeWindow}
                onDelete={deleteWindow}
              />
            )}
          </div>
        </div>
      </div>

      {previewArticleId && (
        <ArticlePreviewDrawer
          articleId={previewArticleId}
          routing={previewRouting}
          onClose={() => { setPreviewArticleId(null); setPreviewRouting(null); }}
        />
      )}
    </>
  );
}

function TabBtn({ active, onClick, children }:
    { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
            style={{ background: "none", border: "none",
                     color: active ? "var(--text-primary)" : "var(--text-muted)",
                     borderBottom: active ? "2px solid var(--accent-gold)" : "2px solid transparent",
                     padding: "8px 4px", fontSize: "var(--fs-sm)", fontWeight: 500,
                     cursor: "pointer" }}>
      {children}
    </button>
  );
}

function ArticleTab({ loading, articles, onArticleClick }: {
  loading: boolean;
  articles: Array<{ short_id: string; title: string | null; publish_time: string | null;
                    routing: string | null; queue_status: string | null }>;
  onArticleClick: (id: string, routing: string | null) => void;
}) {
  if (loading) {
    return <div style={{ padding: 20, color: "var(--text-muted)",
                          fontSize: "var(--fs-sm)" }}>加载中…</div>;
  }
  if (articles.length === 0) {
    return <div style={{ padding: 20, color: "var(--text-faint)",
                          fontSize: "var(--fs-sm)", textAlign: "center" }}>暂无文章</div>;
  }
  return (
    <>
      <div style={{ display: "grid",
                    gridTemplateColumns: "minmax(200px,1fr) 100px 80px 80px",
                    padding: "6px 16px", borderBottom: "1px solid var(--bg-panel)",
                    background: "var(--bg-panel)", color: "var(--text-muted)",
                    fontSize: "var(--fs-xs)", fontWeight: 500,
                    position: "sticky", top: 0, zIndex: 1 }}>
        <span>标题</span>
        <span style={{ textAlign: "center" }}>发布时间</span>
        <span style={{ textAlign: "center" }}>推送</span>
        <span style={{ textAlign: "center" }}>状态</span>
      </div>
      {articles.map(a => (
        <div key={a.short_id}
             style={{ display: "grid",
                      gridTemplateColumns: "minmax(200px,1fr) 100px 80px 80px",
                      padding: "8px 16px", alignItems: "center",
                      borderBottom: "1px solid var(--bg-panel)" }}>
          <a onClick={() => onArticleClick(a.short_id, a.routing)}
             style={{ color: "var(--accent-blue)", cursor: "pointer",
                      fontSize: "var(--fs-sm)", textDecoration: "none",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {a.title || a.short_id}
          </a>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)",
                          textAlign: "center" }}>
            {fmtTime(a.publish_time)}
          </span>
          <span style={{ textAlign: "center" }}>{routingPill(a.routing)}</span>
          <span style={{ textAlign: "center" }}>
            {a.queue_status ? statusLabel(a.queue_status) : "—"}
          </span>
        </div>
      ))}
    </>
  );
}

function SubscriberTab({ subscribers, onClose, onDelete }: {
  subscribers: Array<{ user_id: number; user_name: string; started_at: string;
                       ended_at: string | null; window_id: number }>;
  onClose: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  if (subscribers.length === 0) {
    return <div style={{ padding: 20, color: "var(--text-faint)",
                          fontSize: "var(--fs-sm)", textAlign: "center" }}>暂无订阅者</div>;
  }
  return (
    <>
      <div style={{ display: "grid",
                    gridTemplateColumns: "minmax(140px,1fr) 110px 110px 110px",
                    padding: "6px 16px", borderBottom: "1px solid var(--bg-panel)",
                    background: "var(--bg-panel)", color: "var(--text-muted)",
                    fontSize: "var(--fs-xs)", fontWeight: 500,
                    position: "sticky", top: 0, zIndex: 1 }}>
        <span>用户</span>
        <span style={{ textAlign: "center" }}>起始</span>
        <span style={{ textAlign: "center" }}>状态</span>
        <span style={{ textAlign: "center" }}>操作</span>
      </div>
      {subscribers.map(s => (
        <div key={s.window_id}
             style={{ display: "grid",
                      gridTemplateColumns: "minmax(140px,1fr) 110px 110px 110px",
                      padding: "8px 16px", alignItems: "center",
                      borderBottom: "1px solid var(--bg-panel)",
                      color: s.ended_at ? "var(--text-faint)" : "var(--text-primary)" }}>
          <span style={{ fontSize: "var(--fs-sm)" }}>{s.user_name}</span>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)",
                          textAlign: "center" }}>
            {fmtTime(s.started_at)}
          </span>
          <span style={{ fontSize: "var(--fs-sm)", textAlign: "center",
                          color: s.ended_at ? "var(--text-faint)" : "var(--accent-green)" }}>
            {s.ended_at ? `已结束` : "活跃"}
          </span>
          <span style={{ display: "flex", gap: 6, justifyContent: "center" }}>
            {!s.ended_at && (
              <button onClick={() => onClose(s.window_id)}
                      style={{ background: "var(--bg-panel)",
                               border: "1px solid var(--border)", borderRadius: 4,
                               color: "var(--text-muted)", padding: "2px 6px",
                               cursor: "pointer", fontSize: "var(--fs-xs)" }}>
                关闭
              </button>
            )}
            <button onClick={() => onDelete(s.window_id)}
                    style={{ background: "none", border: "none",
                             color: "var(--text-muted)", cursor: "pointer" }}>
              <Trash2 size={13} />
            </button>
          </span>
        </div>
      ))}
    </>
  );
}
