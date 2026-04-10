import { BookOpen, ExternalLink, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccounts } from "../hooks/useAccounts";
import { AdminManagementPanel } from "./AdminManagementPanel";
import { ArticleAdminPanel } from "./ArticleAdminPanel";
import { AnalysisQueuePanel } from "./AnalysisQueuePanel";
import AggregationQueuePanel from "./AggregationQueuePanel";
import { InviteManagementPanel } from "./InviteManagementPanel";
import { UserManagementPanel } from "./UserManagementPanel";
import type { Article } from "../types";

type AdminView = "management" | "analysis" | "queue" | "aggregation" | "invites" | "users";

interface AdminPaneProps {
  adminView: AdminView;
  onAdminViewChange: (view: AdminView) => void;
  activeArticle: Article | null;
  articles: Article[];
  currentUser: { role: string };
  onSelectArticle: (id: string) => void;
  onExitAdmin: () => void;
  isLoadingArticles?: boolean;
}

export function AdminPane({
  adminView, onAdminViewChange, activeArticle, articles, currentUser,
  onSelectArticle, onExitAdmin, isLoadingArticles,
}: AdminPaneProps) {
  const { data: accounts = [] } = useAccounts();
  const queryClient = useQueryClient();

  return (
    <>
      {/* Admin toolbar with tabs */}
      <div className="reader-toolbar" style={{ borderBottom: '1px solid #30363d', paddingBottom: 8, justifyContent: 'flex-start', gap: 8 }}>
        <ShieldCheck size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />
        <span style={{ fontSize: '0.8rem', color: '#60a5fa', fontWeight: 600, flexShrink: 0 }}>管理</span>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
          <button
            onClick={() => onAdminViewChange("management")}
            style={{
              fontSize: '0.75rem', padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
              background: adminView === "management" ? '#1f6feb' : '#21262d',
              color: adminView === "management" ? '#fff' : '#8b949e',
            }}
          >
            内容管理
          </button>
          <button
            onClick={() => activeArticle && onAdminViewChange("analysis")}
            disabled={!activeArticle}
            style={{
              fontSize: '0.75rem', padding: '3px 10px', borderRadius: 5, border: 'none',
              cursor: activeArticle ? 'pointer' : 'default',
              background: adminView === "analysis" ? '#1f6feb' : '#21262d',
              color: adminView === "analysis" ? '#fff' : (activeArticle ? '#8b949e' : '#4b5563'),
              maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
            title={activeArticle?.title}
          >
            {activeArticle ? `分析: ${activeArticle.title.slice(0, 20)}…` : "分析（请选择文章）"}
          </button>
          <button
            onClick={() => onAdminViewChange("queue")}
            style={{
              fontSize: '0.75rem', padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
              background: adminView === "queue" ? '#1f6feb' : '#21262d',
              color: adminView === "queue" ? '#fff' : '#8b949e',
            }}
          >
            任务队列
          </button>
          <button
            onClick={() => onAdminViewChange("aggregation")}
            style={{
              fontSize: '0.75rem', padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
              background: adminView === "aggregation" ? '#1f6feb' : '#21262d',
              color: adminView === "aggregation" ? '#fff' : '#8b949e',
            }}
          >
            聚合队列
          </button>
          {currentUser.role === "admin" && (
            <>
              <button
                onClick={() => onAdminViewChange("invites")}
                style={{
                  fontSize: '0.75rem', padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: adminView === "invites" ? '#1f6feb' : '#21262d',
                  color: adminView === "invites" ? '#fff' : '#8b949e',
                }}
              >
                邀请码
              </button>
              <button
                onClick={() => onAdminViewChange("users")}
                style={{
                  fontSize: '0.75rem', padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: adminView === "users" ? '#1f6feb' : '#21262d',
                  color: adminView === "users" ? '#fff' : '#8b949e',
                }}
              >
                用户管理
              </button>
            </>
          )}
        </div>
        <div style={{ flex: 1 }} />
        {activeArticle && (
          <button className="btn-icon" title="打开原文" onClick={() => window.open(activeArticle.url)}>
            <ExternalLink size={16} />
          </button>
        )}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {adminView === "management" ? (
          <AdminManagementPanel
            accounts={accounts}
            articles={articles}
            isLoading={isLoadingArticles}
            onRefresh={() => { queryClient.invalidateQueries({ queryKey: ["accounts"] }); queryClient.invalidateQueries({ queryKey: ["articles"] }); }}
            onSelectArticle={(id) => {
              onSelectArticle(id);
              onAdminViewChange("analysis");
            }}
          />
        ) : adminView === "queue" ? (
          <AnalysisQueuePanel onNavigateToArticle={(id) => {
            onSelectArticle(id);
            onExitAdmin();
          }} />
        ) : adminView === "aggregation" ? (
          <AggregationQueuePanel />
        ) : adminView === "invites" ? (
          <InviteManagementPanel />
        ) : adminView === "users" ? (
          <UserManagementPanel />
        ) : activeArticle ? (
          <ArticleAdminPanel
            article={activeArticle}
            onArticleUpdate={() => queryClient.invalidateQueries({ queryKey: ["articles"] })}
          />
        ) : (
          <div className="reader-empty">
            <div className="reader-empty-icon"><BookOpen size={48} /></div>
            <h3>请先在内容管理中选择一篇文章</h3>
          </div>
        )}
      </div>
    </>
  );
}
