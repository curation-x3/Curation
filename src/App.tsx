import { useState, useEffect, useRef } from "react";
import { useLayout } from "./hooks/useLayout";
import { useAccounts } from "./hooks/useAccounts";
import type { Article } from "./types";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { BookOpen, ExternalLink, Rss, ChevronLeft, Menu, Layers, X, ShieldCheck, FileText, Sparkles, LogOut, UserMinus, UserPlus, Check } from 'lucide-react';
import { check } from '@tauri-apps/plugin-updater';
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
import AggregationQueuePanel from "./components/AggregationQueuePanel";
import { useAuth } from './lib/authStore';
import { apiFetch, API_BASE, WS_BASE, fetchCardsByDate, fetchAggregatedCards, fetchCardContent, fetchAggregatedCardContent } from './lib/api';
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

async function apiFailureDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: unknown };
    const d = j.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((item) =>
          item && typeof item === "object" && "msg" in item
            ? String((item as { msg: unknown }).msg)
            : JSON.stringify(item),
        )
        .join(" ");
    }
    if (d != null) return String(d);
  } catch {
    /* ignore non-JSON body */
  }
  return res.statusText || `HTTP ${res.status}`;
}


/** Strip YAML frontmatter (---...---) from markdown content. */
function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("---", 3);
  if (end === -1) return md;
  return md.slice(end + 3).trim();
}

const mdComponents: any = {
  img: ({node, ...props}: any) => (
    <img {...props} referrerPolicy="no-referrer" loading="lazy" />
  ),
  table: ({ children, ...props }: any) => (
    <div style={{ overflowX: 'auto', margin: '16px 0', borderRadius: 8, overflow: 'hidden', border: '1px solid #30363d' }}>
      <table {...props} style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>{children}</table>
    </div>
  ),
  th: ({ children, ...props }: any) => (
    <th {...props} style={{
      padding: '11px 16px', textAlign: 'left', fontWeight: 600,
      background: '#1f2937', color: '#f9fafb', borderBottom: '2px solid #3b82f6',
    }}>{children}</th>
  ),
  td: ({ children, ...props }: any) => (
    <td {...props} style={{ padding: '9px 16px', color: '#c9d1d9' }}>{children}</td>
  ),
  tbody: ({ children, ...props }: any) => (
    <tbody {...props}>
      {Array.isArray(children) ? children.map((child: any, i: number) => {
        if (!child) return child;
        return (
          <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#161b22' }}>
            {child.props?.children}
          </tr>
        );
      }) : children}
    </tbody>
  ),
  pre: ({ children, ...props }: any) => (
    <pre {...props} style={{
      background: '#0d1117', border: '1px solid #30363d', borderRadius: 8,
      padding: '16px', overflow: 'auto', fontSize: '0.83rem', lineHeight: 1.6,
      margin: '16px 0',
    }}>{children}</pre>
  ),
  code: ({ children, className, ...props }: any) => {
    const isBlock = className?.startsWith('hljs') || className?.startsWith('language-');
    if (isBlock) return <code className={className} {...props}>{children}</code>;
    return (
      <code style={{
        background: 'rgba(59,130,246,0.1)', padding: '2px 6px', borderRadius: 4,
        fontSize: '0.85em', color: '#93c5fd',
      }} {...props}>{children}</code>
    );
  },
};

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

function CardHeader({ meta }: { meta: { title: string; url: string; publish_time: string; author: string; article_id?: string } }) {
  return (
    <div style={{
      padding: '14px 20px',
      background: '#161b22',
      borderBottom: '1px solid #30363d',
      fontSize: '0.82rem',
      lineHeight: 1.9,
      color: '#8b949e',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <div>
        <a href="#" onClick={(e) => { e.preventDefault(); /* TODO: navigate to article */ }}
          style={{ color: '#e6edf3', textDecoration: 'none', fontWeight: 500, fontSize: '0.88rem', borderBottom: '1px dashed #58a6ff60', cursor: 'pointer' }}>
          {meta.title}
        </a>
      </div>
      <div>{meta.publish_time} — {meta.author}</div>
      <div>
        <a href={meta.url} target="_blank" rel="noopener noreferrer"
          style={{ color: '#58a6ff', textDecoration: 'none', fontSize: '0.8rem' }}>
          微信原文 ↗
        </a>
      </div>
    </div>
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
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"unprocessed" | "all">("unprocessed");
  const [hidingArticleId, setHidingArticleId] = useState<string | null>(null);

  // Layout
  const { isSidebarCollapsed, sidebarWidth, listWidth, isResizingList, startResizeList, toggleSidebar } = useLayout();
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminView, setAdminView] = useState<"management" | "analysis" | "queue" | "aggregation" | "invites" | "users">("management");
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isSubscribeOpen, setIsSubscribeOpen] = useState(false);
  const [isAddArticleOpen, setIsAddArticleOpen] = useState(false);
  const [viewRaw, setViewRaw] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<"none" | "pending" | "running" | "done" | "failed">("none");
  const [summaryWordCount, setSummaryWordCount] = useState(0);
  const [rawWordCount, setRawWordCount] = useState(0);
  const [notification, setNotification] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');

  // Card view state
  type AppMode = "articles" | "cards";
  const [appMode, setAppMode] = useState<AppMode>("articles");
  const [cardViewDate, setCardViewDate] = useState<string | null>(null); // null = 全部
  const [cardDates, setCardDates] = useState<string[]>([]);
  const [cardViewTab, setCardViewTab] = useState<"aggregated" | "source">("aggregated");
  const [cardList, setCardList] = useState<any[]>([]);
  const [activeCard, setActiveCard] = useState<any>(null);
  const [pendingJumpCardId, setPendingJumpCardId] = useState<string | null>(null);

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  // Initial Load: Fetch All Articles
  useEffect(() => {
    fetchArticles(-1);
  }, []);

  // Load Articles when Account changes
  useEffect(() => {
    if (selectedAccountId !== null) {
      fetchArticles(selectedAccountId);
    }
  }, [selectedAccountId]);

  // Animate out the previous article when switching selection (if it was read)
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = prevSelectedRef.current;
    if (prevId && prevId !== selectedArticleId) {
      const prevArt = articles.find(a => a.short_id === prevId);
      if (prevArt && prevArt.read_status) {
        setHidingArticleId(prevId);
      }
    }
    prevSelectedRef.current = selectedArticleId;
  }, [selectedArticleId]);

  // Load full content when article selection changes (no enqueue trigger)
  useEffect(() => {
    if (selectedArticleId === null) return;
    const art = articles.find(a => a.short_id === selectedArticleId);
    if (!art) return;
    setAnalysisStatus("none");
    setSummaryWordCount(0);
    setRawWordCount(0);
    Promise.all([
      apiFetch(`/articles/${art.short_id}/content`).then(r => r.json()),
      apiFetch(`/articles/${art.short_id}/raw`).then(r => r.json()),
      apiFetch(`/articles/${art.short_id}/analysis-status`).then(r => r.json()),
    ]).then(async ([resp, rawResp, statusResp]) => {
      // Auto-enqueued (no runs yet) → enter polling
      if (resp.source === "enqueued") {
        setActiveArticle({
          ...art,
          markdown: undefined,
          rawMarkdown: rawResp.content,
          rawHtml: rawResp.format === "html" ? rawResp.content : undefined,
          contentFormat: rawResp.format,
          serving_run_id: undefined,
          content_source: "enqueued",
        });
        setViewRaw(true);
        setAnalysisStatus("pending");
        return;
      }
      // Error from /content (no_serving_run, no_cards, card_files_missing)
      if (resp.source === "error") {
        console.error(`[content] Article ${art.short_id}: ${resp.error}`, resp.missing ?? "");
        setActiveArticle({
          ...art,
          markdown: undefined,
          rawMarkdown: rawResp.content,
          rawHtml: rawResp.format === "html" ? rawResp.content : undefined,
          contentFormat: rawResp.format,
          serving_run_id: resp.serving_run_id,
          content_source: "error",
        });
        setViewRaw(true);
        setAnalysisStatus(statusResp.analysis_status ?? "none");
        return;
      }
      // Normal analysis content
      setViewRaw(resp.source !== "analysis");
      setSummaryWordCount(resp.word_count ?? 0);
      setRawWordCount(resp.raw_word_count ?? 0);
      setActiveArticle({
        ...art,
        markdown: resp.content,
        cards: resp.source === "analysis" && resp.cards ? resp.cards : undefined,
        article_meta: resp.article_meta,
        rawMarkdown: rawResp.content,
        rawHtml: rawResp.format === "html" ? rawResp.content : undefined,
        contentFormat: rawResp.format,
        serving_run_id: resp.serving_run_id,
        content_source: resp.source,
      });
      setAnalysisStatus(statusResp.analysis_status ?? "none");
      // Refresh article list so admin panel reflects updated html_path/markdown_path
      fetchArticles(selectedAccountId ?? -1);
    }).catch(err => {
      console.error(`[content] Failed to load article ${art.short_id}:`, err);
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
    const updated = articles.find(a => a.short_id === activeArticle.short_id);
    if (!updated) return;
    if (updated.serving_run_id !== activeArticle.serving_run_id) {
      apiFetch(`/articles/${activeArticle.short_id}/content`)
        .then(r => r.json())
        .then(resp => {
          setActiveArticle(prev => prev ? {
            ...prev,
            markdown: resp.content,
            cards: resp.source === "analysis" && resp.cards ? resp.cards : undefined,
            article_meta: resp.article_meta,
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
      fetchArticles(selectedAccountId ?? -1);
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [selectedAccountId]);

  // Poll analysis status while pending/running
  useEffect(() => {
    if (!selectedArticleId || (analysisStatus !== "pending" && analysisStatus !== "running")) return;
    const id = setInterval(async () => {
      try {
        const resp = await apiFetch(`/articles/${selectedArticleId}/analysis-status`).then(r => r.json());
        const newStatus = resp.analysis_status;
        setAnalysisStatus(newStatus);
        if (newStatus === "done") {
          const [contentResp, rawResp] = await Promise.all([
            apiFetch(`/articles/${selectedArticleId}/content`).then(r => r.json()),
            apiFetch(`/articles/${selectedArticleId}/raw`).then(r => r.json()),
          ]);
          if (contentResp.source === "error") {
            console.error(`[polling] Article ${selectedArticleId}: ${contentResp.error}`, contentResp.missing ?? "");
            return;
          }
          setSummaryWordCount(contentResp.word_count ?? 0);
          setRawWordCount(contentResp.raw_word_count ?? 0);
          setActiveArticle(prev => prev ? {
            ...prev,
            markdown: contentResp.content,
            cards: contentResp.source === "analysis" && contentResp.cards ? contentResp.cards : undefined,
            article_meta: contentResp.article_meta,
            rawMarkdown: rawResp.content,
            serving_run_id: contentResp.serving_run_id,
            content_source: contentResp.source,
          } : null);
          setViewRaw(false);
          setNotification(`「${activeArticle?.title?.slice(0, 20) ?? ""}」AI 总结已生成`);
          fetchArticles(selectedAccountId ?? -1);
        }
      } catch (err) {
        console.error(`[polling] Failed for article ${selectedArticleId}:`, err);
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

  // Card list loading
  useEffect(() => {
    if (appMode !== "cards") return;
    const load = async () => {
      try {
        if (cardViewDate) {
          if (cardViewTab === "aggregated") {
            const resp = await fetchAggregatedCards(cardViewDate);
            setCardList(resp.cards || []);
          } else {
            const resp = await fetchCardsByDate(cardViewDate);
            setCardList(resp.cards || []);
          }
        } else {
          // "全部": load all cards (no date filter)
          if (cardViewTab === "aggregated") {
            setCardList([]);  // aggregated cards require a date
          } else {
            const resp = await apiFetch(`/cards`).then(r => r.json());
            setCardList(resp.cards || []);
          }
        }
      } catch (err) {
        console.error("Failed to fetch cards", err);
        setCardList([]);
      }
      setActiveCard(null);
    };
    load();
  }, [appMode, cardViewDate, cardViewTab]);

  async function loadCardContent(card: any) {
    try {
      const fetcher = cardViewTab === "aggregated" ? fetchAggregatedCardContent : fetchCardContent;
      const resp = await fetcher(card.card_id);
      setActiveCard({ ...card, content: resp.content, title: resp.title ?? card.title, article_meta: resp.article_meta });
    } catch (err) {
      console.error("Failed to load card content", err);
    }
  }

  function jumpToSourceCard(id: string) {
    setPendingJumpCardId(id);
    setCardViewTab("source");
  }

  // Resolve pending jump once the card list has loaded
  useEffect(() => {
    if (!pendingJumpCardId || cardList.length === 0) return;
    const found = cardList.find((c: any) => c.card_id === pendingJumpCardId);
    if (found) {
      loadCardContent(found);
      setPendingJumpCardId(null);
    }
  }, [cardList, pendingJumpCardId]);

  const fetchArticles = async (accountId: number) => {
    const path = accountId === -1 ? `/articles` : `/articles?account_id=${accountId}`;
    try {
      const resp = await apiFetch(path).then(r => r.json());
      if (resp.status === "ok") setArticles(resp.data);
    } catch (err) {
      console.error("Failed to fetch articles", err);
    }
  };

  const handleMarkRead = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await apiFetch(`/articles/${id}/read?status=1`, { method: "POST" }).catch(() => {});
    setArticles(prev => prev.map(a => a.short_id === id ? { ...a, read_status: 1 } : a));
  };

  const handleDismissArticle = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setHidingArticleId(id);
    try {
      await apiFetch(`/articles/${id}/dismiss`, { method: 'POST' });
      setArticles(prev => prev.map(a => a.short_id === id ? { ...a, dismissed: 1 } : a));
    } catch (err) {
      console.error("Dismiss failed", err);
      setHidingArticleId(null);
    }
  };

  const handleUnsubscribe = async (e: React.MouseEvent, accountId: number) => {
    e.stopPropagation();
    if (!confirm("确定取消订阅该公众号？已有文章数据不会删除。")) return;
    try {
      const res = await apiFetch(`/accounts/${accountId}/unsubscribe`, { method: "POST" });
      if (!res.ok) {
        const msg = await apiFailureDetail(res);
        alert(`取消订阅失败：${msg}`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (err) {
      console.error("Unsubscribe failed", err);
      alert("取消订阅失败：网络错误");
    }
  };

  const handleResubscribe = async (e: React.MouseEvent, accountId: number) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`/accounts/${accountId}/resubscribe`, { method: "POST" });
      if (!res.ok) {
        const msg = await apiFailureDetail(res);
        alert(`恢复订阅失败：${msg}`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (err) {
      console.error("Resubscribe failed", err);
      alert("恢复订阅失败：网络错误");
    }
  };

  const subscribedAccounts = accounts.filter(a => !a.subscription_type || a.subscription_type === 'subscribed');
  const temporaryAccounts = accounts.filter(a => a.subscription_type === 'temporary');

  return (
    <div className="app-container">
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
          <button className="btn-icon" onClick={toggleSidebar}>
            {isSidebarCollapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
        {/* Mode switch: articles vs cards */}
        {!isSidebarCollapsed && (
          <div className="flex border-b border-gray-200 mb-2" style={{ display: 'flex', borderBottom: '1px solid #30363d' }}>
            <button
              style={{
                flex: 1, padding: '8px 0', fontSize: '0.82rem', border: 'none', cursor: 'pointer',
                background: 'transparent',
                color: appMode === "articles" ? '#e6edf3' : '#8b949e',
                borderBottom: appMode === "articles" ? '2px solid #3b82f6' : '2px solid transparent',
                fontWeight: appMode === "articles" ? 600 : 400,
              }}
              onClick={() => setAppMode("articles")}
            >
              文章
            </button>
            <button
              style={{
                flex: 1, padding: '8px 0', fontSize: '0.82rem', border: 'none', cursor: 'pointer',
                background: 'transparent',
                color: appMode === "cards" ? '#e6edf3' : '#8b949e',
                borderBottom: appMode === "cards" ? '2px solid #3b82f6' : '2px solid transparent',
                fontWeight: appMode === "cards" ? 600 : 400,
              }}
              onClick={() => setAppMode("cards")}
            >
              卡片
            </button>
          </div>
        )}

        <div className="account-list" style={{ display: appMode === "articles" ? undefined : "none" }}>
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

        {/* Card mode sidebar: date picker */}
        {appMode === "cards" && (
          <div className="account-list">
            {/* 全部卡片 */}
            <div
              className={`account-item ${cardViewDate === null ? 'active' : ''}`}
              onClick={() => setCardViewDate(null)}
              title="全部卡片"
            >
              <div className="account-avatar" style={{ background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <Layers size={18} />
              </div>
              {!isSidebarCollapsed && (
                <div className="account-info">
                  <div className="account-name">全部卡片</div>
                </div>
              )}
            </div>
            {/* 日期列表 */}
            {cardDates.map((date) => {
              const d = new Date(date + 'T00:00:00');
              const isToday = date === new Date().toISOString().split("T")[0];
              const label = isToday ? '今天' : `${d.getMonth() + 1}月${d.getDate()}日`;
              const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
              return (
                <div
                  key={date}
                  className={`account-item ${cardViewDate === date ? 'active' : ''}`}
                  onClick={() => setCardViewDate(date)}
                  title={isSidebarCollapsed ? `${label} 周${weekday}` : ""}
                >
                  <div className="account-avatar" style={{
                    background: '#21262d', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: isToday ? '#3b82f6' : '#8b949e', fontSize: '0.75rem', fontWeight: 600,
                  }}>
                    {d.getDate()}
                  </div>
                  {!isSidebarCollapsed && (
                    <div className="account-info">
                      <div className="account-name">{label}</div>
                      <div style={{ fontSize: '0.7rem', color: '#8b949e' }}>周{weekday}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

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
          onSuccess={() => { setIsSubscribeOpen(false); queryClient.invalidateQueries({ queryKey: ["accounts"] }); }}
        />
        <AddArticleModal
          open={isAddArticleOpen}
          onClose={() => setIsAddArticleOpen(false)}
          accounts={accounts}
          onRefresh={() => { queryClient.invalidateQueries({ queryKey: ["accounts"] }); fetchArticles(selectedAccountId ?? -1); }}
        />
      </aside>

      {/* Pane 2: Article List (articles mode) */}
      {appMode === "articles" && <section className="article-list-pane" style={{ width: listWidth }}>
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
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'unprocessed' ? 'active' : ''}`}
              onClick={() => setViewMode('unprocessed')}
            >未读</button>
            <button
              className={`view-toggle-btn ${viewMode === 'all' ? 'active' : ''}`}
              onClick={() => setViewMode('all')}
            >全部</button>
          </div>
        </header>
        <div className="list-content">
          {(() => {
            let lastDate = '';
            return articles
              .filter(a => a.title.toLowerCase().includes(searchQuery.toLowerCase()))
              .filter(a => viewMode === 'all' || (!a.read_status && !a.dismissed))
              .map(art => {
              const dateStr = (art.publish_time || '').split(' ')[0] || '';
              const showSeparator = dateStr && dateStr !== lastDate;
              if (dateStr) lastDate = dateStr;
              return (
                <div key={art.short_id}>
                  {showSeparator && <div className="date-separator">{dateStr}</div>}
                  <div
                    className={`article-card-wrapper ${hidingArticleId === art.short_id && viewMode === 'unprocessed' ? 'hiding' : ''}`}
                    onTransitionEnd={(e) => {
                      if (e.propertyName === 'max-height' && hidingArticleId === art.short_id) {
                        setHidingArticleId(null);
                      }
                    }}
                  >
                    <div
                      className={`article-card ${selectedArticleId === art.short_id ? 'active' : ''}`}
                      onClick={() => setSelectedArticleId(art.short_id)}
                    >
                      <div className="article-card-left">
                        <div className={`article-card-title ${art.read_status ? 'read' : ''}`}>{art.title}</div>
                        {art.digest && <div className="article-card-digest">{art.digest}</div>}
                        <div className="article-card-meta">
                          {art.publish_time}{art.word_count ? ` · 约${art.word_count}字 · 阅读约${Math.max(1, Math.round(art.word_count / 400))}分钟` : ''}{art.account && <> · <span
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
                        {!art.read_status && (
                          <button className="btn-icon" title="标记已读" onClick={(e) => handleMarkRead(e, art.short_id)}
                            style={{ color: '#8b949e' }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#3fb950')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#8b949e')}>
                            <Check size={14} />
                          </button>
                        )}
                        <button className="btn-icon dismiss-btn" onClick={(e) => handleDismissArticle(e, art.short_id)}>
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </section>}

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
                  onRefresh={() => { queryClient.invalidateQueries({ queryKey: ["accounts"] }); fetchArticles(selectedAccountId ?? -1); }}
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
            {/* Word count info bar */}
            {activeArticle.content_source === "analysis" && summaryWordCount > 0 && rawWordCount > 0 && (
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
            {activeArticle.content_source !== "analysis" && rawWordCount > 0 && viewRaw && (
              <div style={{
                padding: '6px 16px', fontSize: '0.78rem', color: '#8b949e',
                background: '#161b22', borderBottom: '1px solid #21262d',
              }}>
                全文约{rawWordCount}字 · 阅读约{Math.max(1, Math.round(rawWordCount / 400))}分钟
              </div>
            )}
            <div className="reader-content animate-in">
              {activeArticle.content_source === "not_loaded" ? (
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
                    {viewRaw && activeArticle.contentFormat === "html" ? (
                      <div
                        className="rich-text-content"
                        dangerouslySetInnerHTML={{ __html: activeArticle.rawMarkdown || "" }}
                      />
                    ) : !viewRaw && activeArticle.cards && activeArticle.cards.length > 0 ? (
                      <>
                        {/* Article meta header - once */}
                        {activeArticle.article_meta && <CardHeader meta={activeArticle.article_meta} />}

                        {/* Card list */}
                        {activeArticle.cards.map((card) => (
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
                          for (const card of activeArticle.cards) {
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
                  onClick={() => loadCardContent(card)}
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
                      onClick={async () => {
                        const endpoint = cardViewTab === "aggregated"
                          ? `/aggregated-cards/${activeCard.card_id}/read`
                          : `/cards/${activeCard.card_id}/read`;
                        await apiFetch(endpoint, { method: "POST" }).catch(() => {});
                        setActiveCard((prev: any) => prev ? { ...prev, read_at: new Date().toISOString() } : null);
                        setCardList((prev: any[]) => prev.map((c: any) => c.card_id === activeCard.card_id ? { ...c, read_at: new Date().toISOString() } : c));
                      }}
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

