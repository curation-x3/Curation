import { useState, useEffect } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, ExternalLink, Rss, ChevronLeft, Menu, Layers, X, ShieldCheck, FileText, Sparkles, LogOut } from 'lucide-react';
import { ArticleAdminPanel } from './components/ArticleAdminPanel';
import { AddMenu } from './components/AddMenu';
import { SubscribeModal } from './components/SubscribeModal';
import { AddArticleModal } from './components/AddArticleModal';
import { AdminManagementPanel } from './components/AdminManagementPanel';
import { AnalysisQueuePanel } from './components/AnalysisQueuePanel';
import { LoginScreen } from './components/LoginScreen';
import { AuthCallback } from './components/AuthCallback';
import { InviteManagementPanel } from './components/InviteManagementPanel';
import { UserManagementPanel } from './components/UserManagementPanel';
import { useAuth } from './lib/authStore';
import { apiFetch } from './lib/api';
import "./App.css";

interface Account {
  id: number;
  biz: string;
  name: string;
  avatar_url?: string;
  description?: string;
  last_monitored_at?: string;
  article_count?: number;
  subscription_type?: "subscribed" | "temporary";
}

interface Article {
  id: number;
  title: string;
  url: string;
  publish_time: string;
  digest?: string;
  cover_url?: string;
  author?: string;
  account?: string;
  markdown?: string;
  rawMarkdown?: string;
  html_path?: string;
  markdown_path?: string;
  account_id?: number;
  serving_run_id?: number | null;
  content_source?: "analysis" | "raw" | "empty";
}

function App() {
  const { state: authState, logout } = useAuth();

  // Handle Authing OIDC callback (URL contains ?code=)
  const isCallback = window.location.search.includes("code=") ||
    window.location.hash.includes("access_token=");

  if (authState.status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "#0d1117", color: "#8b949e", fontSize: 14 }}>
        加载中…
      </div>
    );
  }

  if (isCallback) {
    return <AuthCallback onDone={() => window.location.replace("/")} />;
  }

  if (authState.status === "unauthenticated") {
    return <LoginScreen />;
  }

  const currentUser = authState.user;

  return <AppMain currentUser={currentUser} onLogout={logout} />;
}

function AppMain({ currentUser, onLogout }: {
  currentUser: { id: number; email: string; username: string; role: string };
  onLogout: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(-1); // -1 for All Articles
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Layout States
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [listWidth, setListWidth] = useState(360);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingList, setIsResizingList] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminView, setAdminView] = useState<"management" | "analysis" | "queue" | "invites" | "users">("management");
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isSubscribeOpen, setIsSubscribeOpen] = useState(false);
  const [isAddArticleOpen, setIsAddArticleOpen] = useState(false);
  const [viewRaw, setViewRaw] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<"none" | "pending" | "running" | "done" | "failed">("none");
  const [notification, setNotification] = useState<string | null>(null);

  // Initial Load: Fetch Accounts and All Articles
  useEffect(() => {
    fetchAccounts();
    fetchArticles(-1);
  }, []);

  // Load Articles when Account changes
  useEffect(() => {
    if (selectedAccountId !== null) {
      fetchArticles(selectedAccountId);
    }
  }, [selectedAccountId]);

  // Load full content + request analysis when Article selection changes
  useEffect(() => {
    if (selectedArticleId === null) return;
    const art = articles.find(a => a.id === selectedArticleId);
    if (!art) return;
    setAnalysisStatus("none");
    Promise.all([
      apiFetch(`/articles/${art.id}/content`).then(r => r.json()),
      apiFetch(`/articles/${art.id}/raw`).then(r => r.json()),
      apiFetch(`/articles/${art.id}/request-analysis`, { method: "POST" }).then(r => r.json()),
    ]).then(([resp, rawResp, analysisResp]) => {
      setViewRaw(resp.source !== "analysis");
      setActiveArticle({
        ...art,
        markdown: resp.content,
        rawMarkdown: rawResp.content,
        serving_run_id: resp.serving_run_id,
        content_source: resp.source,
      });
      setAnalysisStatus(analysisResp.analysis_status ?? "none");
    });
  }, [selectedArticleId]);

  // Admin tab: auto-switch to analysis when article selected in admin mode
  useEffect(() => {
    if (isAdminMode && selectedArticleId) setAdminView("analysis");
  }, [selectedArticleId, isAdminMode]);

  // Reset admin view when leaving admin mode
  useEffect(() => {
    if (!isAdminMode) setAdminView("management");
  }, [isAdminMode]);

  // Version check: if serving_run_id changes in the article list, refresh content
  useEffect(() => {
    if (!activeArticle) return;
    const updated = articles.find(a => a.id === activeArticle.id);
    if (!updated) return;
    if (updated.serving_run_id !== activeArticle.serving_run_id) {
      apiFetch(`/articles/${activeArticle.id}/content`)
        .then(r => r.json())
        .then(resp => {
          setActiveArticle(prev => prev ? {
            ...prev,
            markdown: resp.content,
            serving_run_id: resp.serving_run_id,
            content_source: resp.source,
          } : null);
        });
      // Also reset to analysis view when serving run changes
      setViewRaw(false);
    }
  }, [articles]);

  // 5-minute auto-refresh
  useEffect(() => {
    const id = setInterval(() => {
      fetchAccounts();
      fetchArticles(selectedAccountId ?? -1);
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [selectedAccountId]);

  // Poll analysis status while pending/running
  useEffect(() => {
    if (!selectedArticleId || (analysisStatus !== "pending" && analysisStatus !== "running")) return;
    const id = setInterval(async () => {
      const resp = await apiFetch(`/articles/${selectedArticleId}/analysis-status`).then(r => r.json());
      const newStatus = resp.analysis_status;
      setAnalysisStatus(newStatus);
      if (newStatus === "done") {
        const [contentResp, rawResp] = await Promise.all([
          apiFetch(`/articles/${selectedArticleId}/content`).then(r => r.json()),
          apiFetch(`/articles/${selectedArticleId}/raw`).then(r => r.json()),
        ]);
        setActiveArticle(prev => prev ? {
          ...prev,
          markdown: contentResp.content,
          rawMarkdown: rawResp.content,
          serving_run_id: contentResp.serving_run_id,
          content_source: contentResp.source,
        } : null);
        setViewRaw(false);
        setNotification(`「${activeArticle?.title?.slice(0, 20) ?? ""}」AI 总结已生成`);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [selectedArticleId, analysisStatus]);

  // Auto-dismiss notification after 5s
  useEffect(() => {
    if (!notification) return;
    const id = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(id);
  }, [notification]);

  // Resizing logic (kept as before)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar && !isSidebarCollapsed) {
        const newWidth = Math.max(150, Math.min(500, e.clientX));
        setSidebarWidth(newWidth);
      } else if (isResizingList) {
        const currentSidebarWidth = isSidebarCollapsed ? 72 : sidebarWidth;
        const newWidth = Math.max(200, Math.min(600, e.clientX - currentSidebarWidth));
        setListWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      setIsResizingList(false);
      document.body.style.cursor = 'default';
    };

    if (isResizingSidebar || isResizingList) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar, isResizingList, sidebarWidth, isSidebarCollapsed]);

  const fetchAccounts = async () => {
    try {
      const resp = await apiFetch(`/accounts`).then(r => r.json());
      if (resp.status === "ok") setAccounts(resp.data);
    } catch (err) {
      console.error("Failed to fetch accounts", err);
    }
  };

  const fetchArticles = async (accountId: number) => {
    const path = accountId === -1 ? `/articles` : `/articles?account_id=${accountId}`;
    try {
      const resp = await apiFetch(path).then(r => r.json());
      if (resp.status === "ok") setArticles(resp.data);
    } catch (err) {
      console.error("Failed to fetch articles", err);
    }
  };

  const handleDeleteArticle = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm("确定要删除这篇文章吗？")) return;
    try {
      await apiFetch(`/articles/${id}`, { method: 'DELETE' });
      fetchArticles(selectedAccountId || -1);
      if (selectedArticleId === id) setActiveArticle(null);
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  const subscribedAccounts = accounts.filter(a => !a.subscription_type || a.subscription_type === 'subscribed');
  const temporaryAccounts = accounts.filter(a => a.subscription_type === 'temporary');

  return (
    <div className="app-container">
      {/* Pane 1: Sidebar (Accounts) */}
      <aside
        className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}
        style={{ width: isSidebarCollapsed ? 72 : 280 }}
      >
        <div className="sidebar-header">
          <h2 className="sidebar-title">
            <Rss size={20} />
            <span>公众号订阅</span>
          </h2>
          <button className="btn-icon" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}>
            {isSidebarCollapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
        <div className="account-list">
          {/* Virtual Entry: All Articles */}
          <div
            className={`account-item ${selectedAccountId === -1 ? 'active' : ''}`}
            onClick={() => setSelectedAccountId(-1)}
            title="全部文章"
          >
            <div className="account-avatar" style={{ background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Layers size={18} />
            </div>
            <div className="account-info">
              <div className="account-name">全部文章</div>
            </div>
          </div>

          {subscribedAccounts.map(acc => (
            <div
              key={acc.id}
              className={`account-item ${selectedAccountId === acc.id ? 'active' : ''}`}
              onClick={() => setSelectedAccountId(acc.id)}
              title={isSidebarCollapsed ? acc.name : ""}
            >
              <img
                src={acc.avatar_url || "https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07xvMibqLuWicX7Y16H1xP81v6B0Sraia9zK0dYniamHwJxiaGvH6v97K8K1icYibib9eA/0"}
                alt={acc.name}
                className="account-avatar"
                referrerPolicy="no-referrer"
              />
              <div className="account-info">
                <div className="account-name">{acc.name}</div>
              </div>
            </div>
          ))}

          {temporaryAccounts.length > 0 && (
            <>
              {!isSidebarCollapsed && (
                <div style={{ padding: '10px 14px 4px', fontSize: '0.68rem', color: '#6e7681', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  临时阅读
                </div>
              )}
              {temporaryAccounts.map(acc => (
                <div
                  key={acc.id}
                  className={`account-item ${selectedAccountId === acc.id ? 'active' : ''}`}
                  onClick={() => setSelectedAccountId(acc.id)}
                  title={isSidebarCollapsed ? acc.name : ""}
                  style={{ opacity: 0.8 }}
                >
                  <img
                    src={acc.avatar_url || "https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07xvMibqLuWicX7Y16H1xP81v6B0Sraia9zK0dYniamHwJxiaGvH6v97K8K1icYibib9eA/0"}
                    alt={acc.name}
                    className="account-avatar"
                    referrerPolicy="no-referrer"
                  />
                  <div className="account-info">
                    <div className="account-name">{acc.name}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        
        <div className="sidebar-footer" style={{ padding: '10px', borderTop: '1px solid #30363d' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', position: 'relative' }}>
            {/* + button with popup menu */}
            <div style={{ position: 'relative', flex: 1 }}>
              <AddMenu
                open={isAddMenuOpen}
                onClose={() => setIsAddMenuOpen(false)}
                onSubscribe={() => { setIsAddMenuOpen(false); setIsSubscribeOpen(true); }}
                onAddArticle={() => { setIsAddMenuOpen(false); setIsAddArticleOpen(true); }}
              />
              <button
                className="primary-btn"
                style={{ width: '100%', height: '36px', fontSize: '1.1rem' }}
                onClick={() => setIsAddMenuOpen(v => !v)}
                title="添加内容"
              >
                + {!isSidebarCollapsed && <span style={{ fontSize: '0.82rem', marginLeft: 4 }}>添加</span>}
              </button>
            </div>
            {!isSidebarCollapsed && currentUser.role === "admin" && (
              <button
                className="btn-icon"
                style={{ background: isAdminMode ? '#1d4ed8' : '#21262d' }}
                title="管理员模式"
                onClick={() => setIsAdminMode(v => !v)}
              >
                <ShieldCheck size={18} />
              </button>
            )}
          </div>
          {/* User info + logout */}
          {!isSidebarCollapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px' }}>
              <span style={{ fontSize: '0.72rem', color: '#8b949e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentUser.email || currentUser.username}
              </span>
              <button
                className="btn-icon"
                title="退出登录"
                onClick={onLogout}
                style={{ padding: 4 }}
              >
                <LogOut size={14} style={{ color: '#8b949e' }} />
              </button>
            </div>
          )}
        </div>

        {/* Modals */}
        <SubscribeModal
          open={isSubscribeOpen}
          onClose={() => setIsSubscribeOpen(false)}
          onSuccess={() => { setIsSubscribeOpen(false); fetchAccounts(); }}
        />
        <AddArticleModal
          open={isAddArticleOpen}
          onClose={() => setIsAddArticleOpen(false)}
          accounts={accounts}
          onRefresh={() => { fetchAccounts(); fetchArticles(selectedAccountId ?? -1); }}
        />
      </aside>

      {/* Pane 2: Article List */}
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
        </header>
        <div className="list-content">
          {articles.filter(a => a.title.toLowerCase().includes(searchQuery.toLowerCase())).map(art => (
            <div 
              key={art.id} 
              className={`article-card ${selectedArticleId === art.id ? 'active' : ''}`}
              onClick={() => setSelectedArticleId(art.id)}
            >
              <div className="article-card-left">
                <div className="article-card-title">{art.title}</div>
                <div className="article-card-digest">{art.digest || "暂无摘要"}</div>
                <div className="article-card-meta">
                  {art.publish_time} · {art.account}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                {art.cover_url && (
                  <img src={art.cover_url} alt="Cover" className="article-card-thumb" referrerPolicy="no-referrer" />
                )}
                <button className="btn-icon delete-btn" onClick={(e) => handleDeleteArticle(e, art.id)}>
                  <X size={14} style={{ color: '#f85149' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Resizer 2 */}
      <div 
        className={`resizer ${isResizingList ? 'resizing' : ''}`} 
        onMouseDown={() => setIsResizingList(true)}
      />

      {/* Pane 3: Reader View / Admin Panel */}
      <main className="reader-pane" style={isAdminMode ? { overflow: 'hidden' } : undefined}>
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
                  onRefresh={() => { fetchAccounts(); fetchArticles(selectedAccountId ?? -1); }}
                  onSelectArticle={(id) => {
                    setSelectedArticleId(id);
                    setAdminView("analysis");
                  }}
                />
              ) : adminView === "queue" ? (
                <AnalysisQueuePanel />
              ) : activeArticle ? (
                <ArticleAdminPanel
                  article={activeArticle}
                  onArticleUpdate={() => fetchArticles(selectedAccountId ?? -1)}
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
          <>
            <div className="reader-toolbar">
              {/* View mode segmented control */}
              <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid #30363d', marginRight: 'auto' }}>
                <button
                  onClick={() => setViewRaw(true)}
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
                  onClick={() => setViewRaw(false)}
                  disabled={activeArticle.content_source !== "analysis" && analysisStatus !== "pending" && analysisStatus !== "running"}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: '0.75rem', padding: '5px 12px',
                    border: 'none',
                    cursor: activeArticle.content_source === "analysis" ? 'pointer' : 'default',
                    background: !viewRaw ? '#3b82f6' : '#21262d',
                    color: (!viewRaw ? '#fff' : (analysisStatus === "none" || analysisStatus === "failed") ? '#4b5563' : '#8b949e'),
                    transition: 'background 0.15s',
                  }}
                >
                  <Sparkles size={13} />
                  深度总结
                </button>
              </div>
              <button className="btn-icon" title="打开原文" onClick={() => window.open(activeArticle.url)}>
                <ExternalLink size={18} />
              </button>
            </div>
            <div className="reader-content animate-in">
              {!viewRaw && (analysisStatus === "pending" || analysisStatus === "running") ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: '#8b949e' }}>
                  <Sparkles size={32} style={{ opacity: 0.4 }} className="animate-spin" />
                  <span style={{ fontSize: '0.9rem' }}>正在生成 AI 总结...</span>
                </div>
              ) : (
                <div className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      img: ({node, ...props}) => (
                        <img {...props} referrerPolicy="no-referrer" loading="lazy" />
                      )
                    }}
                  >
                    {(viewRaw ? activeArticle.rawMarkdown : activeArticle.markdown) || ""}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="reader-empty">
            <div className="reader-empty-icon"><BookOpen size={64} /></div>
            <h3>请选择文章或通过「+」添加内容</h3>
          </div>
        )}
      </main>

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

