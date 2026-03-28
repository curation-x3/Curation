import { useState, useEffect } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, ExternalLink, Rss, ChevronLeft, Menu, Layers, X, ShieldCheck, FileText, Sparkles, LogOut, UserMinus, UserPlus } from 'lucide-react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
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
import { authingClient } from './lib/authing';
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
  rawHtml?: string;
  contentFormat?: "html" | "markdown";

  // Full-fidelity API fields
  hashid?: string;
  idx?: string;
  ip_wording?: string;
  is_original?: boolean;
  send_to_fans_num?: number;
  user_name?: string;
  alias?: string;
  signature?: string;
  create_time?: string;
}

function App() {
  const { state: authState, logout } = useAuth();

  if (authState.status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "#0d1117", color: "#8b949e", fontSize: 14 }}>
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
    return <LoginScreen />;
  }

  const currentUser = authState.user;

  function handleLogout() {
    logout();  // clear local session
    authingClient.logoutWithRedirect({
      redirectUri: import.meta.env.VITE_AUTHING_REDIRECT_URI?.replace("/auth/callback", "") || window.location.origin,
    });
  }

  return <AppMain key={currentUser.id} currentUser={currentUser} onLogout={handleLogout} />;
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
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('curation_sidebar_width') || 200));
  const [listWidth, setListWidth] = useState(() => Number(localStorage.getItem('curation_list_width') || 260));
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
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  // Initial Load: Fetch Accounts and All Articles
  useEffect(() => {
    fetchAccounts();
    fetchArticles(-1);
  }, []);

  // Check for updates every minute
  useEffect(() => {
    const doCheck = () => check()
      .then(u => {
        console.log('[updater] check result:', u ? `update available: ${u.version}` : 'up to date');
        if (u) setPendingUpdate(u);
      })
      .catch(e => console.error('[updater] check failed:', e));
    doCheck();
    const timer = setInterval(doCheck, 60 * 1000);
    return () => clearInterval(timer);
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
        rawHtml: rawResp.format === "html" ? rawResp.content : undefined,
        contentFormat: rawResp.format,
        serving_run_id: resp.serving_run_id,
        content_source: resp.source,
      });
      setAnalysisStatus(analysisResp.analysis_status ?? "none");
      // Refresh article list so admin panel reflects updated html_path/markdown_path
      fetchArticles(selectedAccountId ?? -1);
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
      if (isResizingSidebar) localStorage.setItem('curation_sidebar_width', String(sidebarWidth));
      if (isResizingList) localStorage.setItem('curation_list_width', String(listWidth));
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

  const handleUnsubscribe = async (e: React.MouseEvent, accountId: number) => {
    e.stopPropagation();
    if (!confirm("确定取消订阅该公众号？已有文章数据不会删除。")) return;
    try {
      await apiFetch(`/accounts/${accountId}/unsubscribe`, { method: "POST" });
      fetchAccounts();
    } catch (err) {
      console.error("Unsubscribe failed", err);
    }
  };

  const handleResubscribe = async (e: React.MouseEvent, accountId: number) => {
    e.stopPropagation();
    try {
      await apiFetch(`/accounts/${accountId}/resubscribe`, { method: "POST" });
      fetchAccounts();
    } catch (err) {
      console.error("Resubscribe failed", err);
    }
  };

  const subscribedAccounts = accounts.filter(a => !a.subscription_type || a.subscription_type === 'subscribed');
  const temporaryAccounts = accounts.filter(a => a.subscription_type === 'temporary');

  const handleInstallUpdate = async () => {
    if (!pendingUpdate) return;
    await pendingUpdate.downloadAndInstall();
    await relaunch();
  };

  return (
    <div className="app-container">
      {pendingUpdate && (
        <button onClick={handleInstallUpdate} style={{
          position: 'fixed', top: 12, right: 16, zIndex: 200,
          background: '#1f6feb', color: '#fff', border: 'none',
          borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
          fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6,
          boxShadow: '0 2px 8px rgba(31,111,235,0.4)',
        }}>
          ↑ 新版本可用，点击重启安装
        </button>
      )}
      {/* Pane 1: Sidebar (Accounts) */}
      <aside
        className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}
        style={{ width: isSidebarCollapsed ? 72 : sidebarWidth }}
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
              style={{ position: 'relative' }}
              onMouseEnter={e => {
                const btn = e.currentTarget.querySelector('.account-action-btn') as HTMLElement | null;
                if (btn) btn.style.opacity = '1';
              }}
              onMouseLeave={e => {
                const btn = e.currentTarget.querySelector('.account-action-btn') as HTMLElement | null;
                if (btn) btn.style.opacity = '0';
              }}
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
              {!isSidebarCollapsed && (
                <button
                  className="btn-icon account-action-btn"
                  title="取消订阅"
                  onClick={(e) => handleUnsubscribe(e, acc.id)}
                  style={{
                    opacity: 0,
                    transition: 'opacity 0.15s',
                    padding: 3,
                    flexShrink: 0,
                    background: 'none',
                  }}
                >
                  <UserMinus size={13} style={{ color: '#f85149' }} />
                </button>
              )}
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
                  style={{ opacity: 0.8, position: 'relative' }}
                  onMouseEnter={e => {
                    const btn = e.currentTarget.querySelector('.account-action-btn') as HTMLElement | null;
                    if (btn) btn.style.opacity = '1';
                    (e.currentTarget as HTMLElement).style.opacity = '1';
                  }}
                  onMouseLeave={e => {
                    const btn = e.currentTarget.querySelector('.account-action-btn') as HTMLElement | null;
                    if (btn) btn.style.opacity = '0';
                    (e.currentTarget as HTMLElement).style.opacity = '0.8';
                  }}
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
                  {!isSidebarCollapsed && (
                    <button
                      className="btn-icon account-action-btn"
                      title="订阅此公众号"
                      onClick={(e) => handleResubscribe(e, acc.id)}
                      style={{
                        opacity: 0,
                        transition: 'opacity 0.15s',
                        padding: 3,
                        flexShrink: 0,
                        background: 'none',
                      }}
                    >
                      <UserPlus size={13} style={{ color: '#3fb950' }} />
                    </button>
                  )}
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
              {appVersion && <span style={{ fontSize: '0.68rem', color: '#484f58', flexShrink: 0 }}>v{appVersion}</span>}
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
                {art.digest && <div className="article-card-digest">{art.digest}</div>}
                <div className="article-card-meta">
                  {art.publish_time}{art.account && <> · <span
                    onClick={e => { e.stopPropagation(); if (art.account_id) setSelectedAccountId(art.account_id); }}
                    style={{ cursor: 'pointer', color: 'var(--primary-color)', textDecoration: 'none' }}
                    onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                    onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                  >{art.account}</span></>}
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
                  onRefresh={() => { fetchAccounts(); fetchArticles(selectedAccountId ?? -1); }}
                  onSelectArticle={(id) => {
                    setSelectedArticleId(id);
                    setAdminView("analysis");
                  }}
                />
              ) : adminView === "queue" ? (
                <AnalysisQueuePanel />
              ) : adminView === "invites" ? (
                <InviteManagementPanel />
              ) : adminView === "users" ? (
                <UserManagementPanel />
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
                <>
                  <div className="markdown-body">
                    {viewRaw && activeArticle.contentFormat === "html" ? (
                      <div 
                        className="rich-text-content" 
                        dangerouslySetInnerHTML={{ __html: activeArticle.rawMarkdown || "" }} 
                      />
                    ) : (
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
                    )}
                  </div>

                  {/* Metadata Inspector (Proof of 100% preservation) */}
                  <div className="metadata-inspector">
                    <h4>元数据详情</h4>
                    <div className="meta-grid">
                      <div className="meta-item"><label>HashID</label><span>{activeArticle.hashid || '-'}</span></div>
                      <div className="meta-item"><label>Idx</label><span>{activeArticle.idx || '-'}</span></div>
                      <div className="meta-item"><label>IP 归属</label><span>{activeArticle.ip_wording || '-'}</span></div>
                      <div className="meta-item"><label>原创</label><span>{activeArticle.is_original ? '是' : '否'}</span></div>
                      <div className="meta-item"><label>送达人数</label><span>{activeArticle.send_to_fans_num || '-'}</span></div>
                      <div className="meta-item"><label>发布时间</label><span>{activeArticle.publish_time}</span></div>
                      <div className="meta-item"><label>创建时间</label><span>{activeArticle.create_time || '-'}</span></div>
                      <div className="meta-item"><label>用户码 (Alias)</label><span>{activeArticle.alias || '-'}</span></div>
                      <div className="meta-item"><label>ID (UserName)</label><span>{activeArticle.user_name || '-'}</span></div>
                    </div>
                  </div>
                </>
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

