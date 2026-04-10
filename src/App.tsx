import { useState, useEffect } from "react";
import { useLayout } from "./hooks/useLayout";
import { useAccounts } from "./hooks/useAccounts";
import type { Article } from "./types";
import { useArticles, useArticleContent, useAnalysisStatus } from "./hooks/useArticles";
import { useCardList, useCardContent, useMarkCardRead } from "./hooks/useCards";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { BookOpen, ExternalLink, X, ShieldCheck, Sparkles } from 'lucide-react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { ArticleAdminPanel } from './components/ArticleAdminPanel';
import { Sidebar } from './components/Sidebar';
import { ArticleList } from './components/ArticleList';
import { ArticleReader } from './components/ArticleReader';
import { AdminManagementPanel } from './components/AdminManagementPanel';
import { AnalysisQueuePanel } from './components/AnalysisQueuePanel';
import { LoginScreen } from './components/LoginScreen';
import { AuthCallback } from './components/AuthCallback';
import { InviteManagementPanel } from './components/InviteManagementPanel';
import { UserManagementPanel } from './components/UserManagementPanel';
import AggregationQueuePanel from "./components/AggregationQueuePanel";
import { useAuth } from './lib/authStore';
import { API_BASE, WS_BASE } from './lib/api';
import { stripFrontmatter, mdComponents, CardHeader } from './lib/markdown';
import { authingClient } from './lib/authing';
import "./App.css";

// Boot info — printed once at startup
getVersion()
  .then(v => {
    console.log(
      `%c Curation v${v} %c\n` +
      `  API:    ${API_BASE}\n` +
      `  WS:     ${WS_BASE}\n` +
      `  Auth:   ${import.meta.env.VITE_AUTHING_DOMAIN ?? '(not set)'}\n` +
      `  Env:    ${import.meta.env.MODE}`,
      'background:#1f6feb;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px',
      '',
    );
  })
  .catch(() => {});


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

function UpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const doCheck = async () => {
      try {
        const u = await check();
        console.log('[updater] check result:', u ? `update available: ${u.version}` : 'up to date');
        if (u) {
          console.log('[updater] downloading in background...');
          await u.downloadAndInstall();
          console.log('[updater] download complete, ready to relaunch');
          setReady(true);
        }
      } catch (e) {
        console.error('[updater] check/download failed:', e);
      }
    };
    doCheck();
    const timer = setInterval(doCheck, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  if (!ready) return null;

  return (
    <button onClick={() => relaunch()} style={{
      position: 'fixed', top: 12, right: 16, zIndex: 200,
      background: '#1f6feb', color: '#fff', border: 'none',
      borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
      fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6,
      boxShadow: '0 2px 8px rgba(31,111,235,0.4)',
    }}>
      ↑ 重启以更新软件
    </button>
  );
}


function App() {
  const { state: authState, logout } = useAuth();

  if (authState.status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "#0d1117", color: "#8b949e", fontSize: 14 }}>
        <UpdateBanner />
        加载中…
      </div>
    );
  }

  // Authing uses fragment mode by default: code comes back in window.location.hash
  const isCallback = authingClient.isRedirectCallback();
  if (isCallback) {
    return <AuthCallback onDone={() => window.location.replace("/")} />;
  }

  if (authState.status === "unauthenticated") {
    return (
      <>
        <UpdateBanner />
        <LoginScreen />
      </>
    );
  }

  const currentUser = authState.user;

  function handleLogout() {
    logout();  // clear local session
    authingClient.logoutWithRedirect({
      redirectUri: import.meta.env.VITE_AUTHING_REDIRECT_URI?.replace("/auth/callback", "") || window.location.origin,
    });
  }

  return (
    <QueryClientProvider client={queryClient}>
      <UpdateBanner />
      <AppMain key={currentUser.id} currentUser={currentUser} onLogout={handleLogout} />
    </QueryClientProvider>
  );
}

function AppMain({ currentUser, onLogout }: {
  currentUser: { id: number; email: string; username: string; role: string };
  onLogout: () => void;
}) {
  const { data: accounts = [] } = useAccounts();
  const queryClient = useQueryClient();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(-1); // -1 for All Articles
  const { data: articles = [] } = useArticles(selectedAccountId);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  // Article content via React Query
  const { data: articleContent } = useArticleContent(selectedArticleId);
  const baseArticle = articles.find(a => a.short_id === selectedArticleId) ?? null;
  const activeArticle: (Article & { summaryWordCount?: number; rawWordCount?: number }) | null =
    baseArticle && articleContent
      ? { ...baseArticle, ...articleContent }
      : baseArticle;

  // Analysis polling
  const contentAnalysisStatus = articleContent?.analysisStatus ?? "none";
  const { data: polledStatus } = useAnalysisStatus(selectedArticleId, contentAnalysisStatus);
  const analysisStatus = polledStatus ?? contentAnalysisStatus;

  // Layout
  const { isSidebarCollapsed, sidebarWidth, listWidth, isResizingList, startResizeList, toggleSidebar } = useLayout();
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminView, setAdminView] = useState<"management" | "analysis" | "queue" | "aggregation" | "invites" | "users">("management");
  const [viewRaw, setViewRaw] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');

  // Card view state
  type AppMode = "articles" | "cards";
  const [appMode, setAppMode] = useState<AppMode>("articles");
  const [cardViewDate, setCardViewDate] = useState<string | null>(null); // null = 全部
  const [cardDates, setCardDates] = useState<string[]>([]);
  const [cardViewTab, setCardViewTab] = useState<"aggregated" | "source">("aggregated");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [pendingJumpCardId, setPendingJumpCardId] = useState<string | null>(null);

  // Card data via React Query
  const { data: cardList = [] } = useCardList(cardViewDate, cardViewTab, appMode === "cards");
  const { data: cardContentData } = useCardContent(selectedCardId, cardViewTab);
  const baseCard = cardList.find(c => c.card_id === selectedCardId) ?? null;
  const activeCard = baseCard && cardContentData
    ? { ...baseCard, content: cardContentData.content, title: cardContentData.title ?? baseCard.title, article_meta: cardContentData.article_meta }
    : null;
  const markCardRead = useMarkCardRead(cardViewDate, cardViewTab);

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  // Auto-set viewRaw based on content source
  useEffect(() => {
    if (!articleContent) return;
    if (articleContent.content_source === "enqueued" || articleContent.content_source === "error") {
      setViewRaw(true);
    } else if (articleContent.content_source === "analysis") {
      setViewRaw(false);
    }
  }, [articleContent]);

  // Admin tab: auto-switch to analysis when article selected in admin mode
  useEffect(() => {
    if (isAdminMode && selectedArticleId) setAdminView("analysis");
  }, [selectedArticleId, isAdminMode]);

  // Reset admin view when leaving admin mode
  useEffect(() => {
    if (!isAdminMode) setAdminView("management");
  }, [isAdminMode]);

  // Notification when analysis completes
  useEffect(() => {
    if (polledStatus === "done" && activeArticle) {
      setNotification(`「${activeArticle.title?.slice(0, 20) ?? ""}」AI 总结已生成`);
      setViewRaw(false);
    }
  }, [polledStatus]);

  // Auto-dismiss notification after 5s
  useEffect(() => {
    if (!notification) return;
    const id = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(id);
  }, [notification]);

  // Generate recent 14 days for card date list
  useEffect(() => {
    if (appMode !== "cards") return;
    const dates: string[] = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split("T")[0]);
    }
    setCardDates(dates);
  }, [appMode]);

  function jumpToSourceCard(id: string) {
    setPendingJumpCardId(id);
    setCardViewTab("source");
  }

  // Resolve pending jump once the card list has loaded
  useEffect(() => {
    if (!pendingJumpCardId || cardList.length === 0) return;
    const found = cardList.find((c: any) => c.card_id === pendingJumpCardId);
    if (found) {
      setSelectedCardId(found.card_id);
      setPendingJumpCardId(null);
    }
  }, [cardList, pendingJumpCardId]);

  return (
    <div className="app-container">
      <Sidebar
        appMode={appMode}
        onAppModeChange={setAppMode}
        selectedAccountId={selectedAccountId}
        onSelectAccount={setSelectedAccountId}
        cardViewDate={cardViewDate}
        onCardViewDateChange={setCardViewDate}
        cardDates={cardDates}
        isSidebarCollapsed={isSidebarCollapsed}
        sidebarWidth={sidebarWidth}
        onToggleSidebar={toggleSidebar}
        isAdminMode={isAdminMode}
        onToggleAdminMode={() => setIsAdminMode(v => !v)}
        currentUser={currentUser}
        onLogout={onLogout}
        appVersion={appVersion}
      />

      {/* Pane 2: Article List (articles mode) */}
      {appMode === "articles" && (
        <ArticleList
          articles={articles}
          selectedArticleId={selectedArticleId}
          onSelectArticle={setSelectedArticleId}
          onSelectAccount={setSelectedAccountId}
          accountId={selectedAccountId}
          listWidth={listWidth}
        />
      )}

      {/* Resizer 2 (articles mode) */}
      {appMode === "articles" && <div
        className={`resizer ${isResizingList ? 'resizing' : ''}`}
        onMouseDown={startResizeList}
      />}

      {/* Pane 3: Reader View / Admin Panel (articles mode) */}
      {appMode === "articles" && <main className="reader-pane" style={isAdminMode ? { overflow: 'hidden' } : undefined}>
        {isAdminMode ? (
          <>
            {/* Admin toolbar with tabs */}
            <div className="reader-toolbar" style={{ borderBottom: '1px solid #30363d', paddingBottom: 8, justifyContent: 'flex-start', gap: 8 }}>
              <ShieldCheck size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />
              <span style={{ fontSize: '0.8rem', color: '#60a5fa', fontWeight: 600, flexShrink: 0 }}>管理</span>
              {/* Tabs */}
              <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
                <button
                  onClick={() => setAdminView("management")}
                  style={{
                    fontSize: '0.75rem', padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                    background: adminView === "management" ? '#1f6feb' : '#21262d',
                    color: adminView === "management" ? '#fff' : '#8b949e',
                  }}
                >
                  内容管理
                </button>
                <button
                  onClick={() => activeArticle && setAdminView("analysis")}
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
                  onClick={() => setAdminView("queue")}
                  style={{
                    fontSize: '0.75rem', padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                    background: adminView === "queue" ? '#1f6feb' : '#21262d',
                    color: adminView === "queue" ? '#fff' : '#8b949e',
                  }}
                >
                  任务队列
                </button>
                <button
                  onClick={() => setAdminView("aggregation")}
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
                      onClick={() => setAdminView("invites")}
                      style={{
                        fontSize: '0.75rem', padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                        background: adminView === "invites" ? '#1f6feb' : '#21262d',
                        color: adminView === "invites" ? '#fff' : '#8b949e',
                      }}
                    >
                      邀请码
                    </button>
                    <button
                      onClick={() => setAdminView("users")}
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
                  onRefresh={() => { queryClient.invalidateQueries({ queryKey: ["accounts"] }); queryClient.invalidateQueries({ queryKey: ["articles"] }); }}
                  onSelectArticle={(id) => {
                    setSelectedArticleId(id);
                    setAdminView("analysis");
                  }}
                />
              ) : adminView === "queue" ? (
                <AnalysisQueuePanel onNavigateToArticle={(id) => {
                  setSelectedArticleId(id);
                  setIsAdminMode(false);
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
        ) : !isAdminMode && activeArticle ? (
          <ArticleReader
            article={activeArticle}
            analysisStatus={analysisStatus}
            viewRaw={viewRaw}
            onViewRawChange={setViewRaw}
          />
        ) : (
          <div className="reader-empty">
            <div className="reader-empty-icon"><BookOpen size={64} /></div>
            <h3>请选择文章或通过「+」添加内容</h3>
          </div>
        )}
      </main>}

      {/* Card view panes (cards mode) */}
      {appMode === "cards" && (
        <>
          {/* Card list pane */}
          <section className="article-list-pane" style={{ width: listWidth }}>
            <header className="list-header">
              <div style={{ display: 'flex', width: '100%', borderBottom: '1px solid #30363d' }}>
                <button
                  style={{
                    flex: 1, padding: '8px 0', fontSize: '0.82rem', border: 'none', cursor: 'pointer',
                    background: 'transparent',
                    color: cardViewTab === "aggregated" ? '#e6edf3' : '#8b949e',
                    borderBottom: cardViewTab === "aggregated" ? '2px solid #3b82f6' : '2px solid transparent',
                    fontWeight: cardViewTab === "aggregated" ? 600 : 400,
                  }}
                  onClick={() => setCardViewTab("aggregated")}
                >
                  聚合卡片
                </button>
                <button
                  style={{
                    flex: 1, padding: '8px 0', fontSize: '0.82rem', border: 'none', cursor: 'pointer',
                    background: 'transparent',
                    color: cardViewTab === "source" ? '#e6edf3' : '#8b949e',
                    borderBottom: cardViewTab === "source" ? '2px solid #3b82f6' : '2px solid transparent',
                    fontWeight: cardViewTab === "source" ? 600 : 400,
                  }}
                  onClick={() => setCardViewTab("source")}
                >
                  原始卡片
                </button>
              </div>
            </header>
            <div className="list-content">
              {cardList.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#8b949e', fontSize: '0.85rem' }}>
                  暂无卡片
                </div>
              ) : cardList.map((card: any) => (
                <div
                  key={card.card_id}
                  style={{
                    padding: '12px 14px', cursor: 'pointer',
                    borderBottom: '1px solid #21262d',
                    background: activeCard?.card_id === card.card_id ? '#1c2333' : 'transparent',
                  }}
                  onClick={() => setSelectedCardId(card.card_id)}
                  onMouseEnter={(e) => { if (activeCard?.card_id !== card.card_id) (e.currentTarget as HTMLElement).style.background = '#161b22'; }}
                  onMouseLeave={(e) => { if (activeCard?.card_id !== card.card_id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <div style={{ fontSize: '0.85rem', fontWeight: card.read_at ? 400 : 500, color: card.read_at ? '#6e7681' : '#e6edf3' }}>{card.title}</div>
                  {card.article_title && (
                    <div style={{ fontSize: '0.75rem', color: '#8b949e', marginTop: 4 }}>{card.article_title}</div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Resizer */}
          <div
            className={`resizer ${isResizingList ? 'resizing' : ''}`}
            onMouseDown={startResizeList}
          />

          {/* Card reader pane */}
          <main className="reader-pane">
            {activeCard ? (
              <>
                <div className="reader-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e6edf3' }}>
                    {activeCard.title}
                  </span>
                  {!activeCard.read_at && (
                    <button
                      onClick={() => markCardRead.mutate(activeCard.card_id)}
                      style={{
                        background: 'none', border: '1px solid #30363d', borderRadius: 4,
                        color: '#8b949e', padding: '2px 10px', cursor: 'pointer', fontSize: '0.78rem',
                      }}
                    >
                      标记已读
                    </button>
                  )}
                </div>
                {activeCard.article_meta && <CardHeader meta={activeCard.article_meta} />}
                <div className="reader-content animate-in">
                  <div className="markdown-body">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                      components={mdComponents}
                    >
                      {stripFrontmatter(activeCard.content || "")}
                    </ReactMarkdown>
                  </div>

                  {/* Source tracing for aggregated cards */}
                  {activeCard.source_card_ids && (
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #30363d', fontSize: '0.82rem', color: '#8b949e' }}>
                      <span>来源卡片：</span>
                      {(() => {
                        try {
                          const ids = typeof activeCard.source_card_ids === "string"
                            ? JSON.parse(activeCard.source_card_ids)
                            : activeCard.source_card_ids;
                          return (ids as string[]).map((id: string) => (
                            <button
                              key={id}
                              onClick={() => jumpToSourceCard(id)}
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
              </>
            ) : (
              <div className="reader-empty">
                <div className="reader-empty-icon"><BookOpen size={64} /></div>
                <h3>请选择一张卡片</h3>
              </div>
            )}
          </main>
        </>
      )}

      {/* Toast notification */}
      {notification && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 500,
          background: '#161b22', border: '1px solid #3fb950',
          borderRadius: 10, padding: '12px 18px',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          animation: 'fadeIn 0.2s ease',
        }}>
          <Sparkles size={16} style={{ color: '#3fb950', flexShrink: 0 }} />
          <span style={{ color: '#e6edf3', fontSize: '0.85rem' }}>{notification}</span>
          <button onClick={() => setNotification(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8b949e', padding: 2, marginLeft: 4 }}>
            <X size={14} />
          </button>
        </div>
      )}

    </div>
  );
}

export default App;

