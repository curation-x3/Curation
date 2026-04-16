import { useState, useEffect, useMemo } from "react";
import { useNavHistory } from './hooks/useNavHistory';
import type { NavLocation } from './hooks/useNavHistory';
import { useLayout } from "./hooks/useLayout";
import type { Article } from "./types";
import { useArticles, useArticleContent, useAnalysisStatus } from "./hooks/useArticles";
import { useCardList, useCardContent, useCardDates } from "./hooks/useCards";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import 'highlight.js/styles/github-dark.css';
import { BookOpen, X, Sparkles } from 'lucide-react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { Sidebar } from './components/Sidebar';
import { AdminPane } from './components/AdminPane';
import { ArticleList } from './components/ArticleList';
import { ArticleReader } from './components/ArticleReader';
import { CardList } from './components/CardList';
import { CardReader } from './components/CardReader';
import { LoginScreen } from './components/LoginScreen';
import { AuthCallback } from './components/AuthCallback';
import { useAuth } from './lib/authStore';
import { API_BASE, WS_BASE } from './lib/api';
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
      refetchOnWindowFocus: false,
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
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(-1); // -1 for All Articles
  const { data: articles = [], isLoading: isLoadingArticles } = useArticles(selectedAccountId);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  // Article content via React Query
  const { data: articleContent, isLoading: isContentLoading } = useArticleContent(selectedArticleId);
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
  const [cardViewTab, setCardViewTab] = useState<"aggregated" | "source">("aggregated");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [pendingJumpCardId, setPendingJumpCardId] = useState<string | null>(null);

  // Navigation history
  const { push: navPush, back: navBack, forward: navForward, canBack, canForward } = useNavHistory({
    appMode: "articles", selectedArticleId: null, selectedAccountId: -1,
    selectedCardId: null, cardViewDate: null, cardViewTab: "aggregated",
  });

  function applyLocation(loc: NavLocation) {
    setAppMode(loc.appMode);
    setSelectedArticleId(loc.selectedArticleId);
    setSelectedAccountId(loc.selectedAccountId);
    setSelectedCardId(loc.selectedCardId);
    setCardViewDate(loc.cardViewDate);
    setCardViewTab(loc.cardViewTab);
  }

  function currentLoc(): NavLocation {
    return { appMode, selectedArticleId, selectedAccountId, selectedCardId, cardViewDate, cardViewTab };
  }

  function navigate(loc: NavLocation) {
    applyLocation(loc);
    navPush(loc);
  }

  function handleBack() {
    const loc = navBack();
    if (loc) applyLocation(loc);
  }

  function handleForward() {
    const loc = navForward();
    if (loc) applyLocation(loc);
  }

  // Card data via React Query
  const { data: cardList = [] } = useCardList(cardViewDate, cardViewTab, appMode === "cards");
  const { data: cardContentData } = useCardContent(selectedCardId, cardViewTab);
  const baseCard = cardList.find(c => c.card_id === selectedCardId) ?? null;
  const activeCard = baseCard && cardContentData
    ? { ...baseCard, content: cardContentData.content, title: cardContentData.title ?? baseCard.title, article_meta: cardContentData.article_meta }
    : null;

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

  // Dates where the user actually has cards
  const { data: cardDatesData } = useCardDates();
  const cardDates = useMemo(() => {
    if (!cardDatesData) return [];
    const all = new Set([...cardDatesData.source, ...cardDatesData.aggregated]);
    return Array.from(all).sort((a, b) => b.localeCompare(a));
  }, [cardDatesData]);

  function jumpToSourceCard(id: string) {
    navPush(currentLoc());
    setPendingJumpCardId(id);
    setCardViewTab("source");
  }

  function jumpToArticle(articleId: string) {
    navigate({ ...currentLoc(), appMode: "articles", selectedArticleId: articleId, selectedCardId: null });
  }

  function jumpToAccount(accountId: number) {
    navigate({ ...currentLoc(), appMode: "articles", selectedAccountId: accountId, selectedArticleId: null, selectedCardId: null });
  }

  function navSelectArticle(articleId: string) {
    navPush({ ...currentLoc(), selectedArticleId: articleId });
    setSelectedArticleId(articleId);
  }

  function navSelectCard(cardId: string) {
    navPush({ ...currentLoc(), appMode: "cards", selectedCardId: cardId });
    setSelectedCardId(cardId);
  }

  function navSetAppMode(mode: AppMode) {
    navigate({ ...currentLoc(), appMode: mode });
  }

  function navSetAccount(id: number | null) {
    navigate({ ...currentLoc(), appMode: "articles", selectedAccountId: id });
  }

  function navSetCardViewDate(date: string | null) {
    navigate({ ...currentLoc(), appMode: "cards", cardViewDate: date });
  }

  // Keyboard back/forward: Alt+← / Alt+→
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); handleBack(); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); handleForward(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canBack, canForward, navBack, navForward]);

  // Resolve pending jump once the card list has loaded
  useEffect(() => {
    if (!pendingJumpCardId || cardList.length === 0) return;
    const found = cardList.find((c: any) => c.card_id === pendingJumpCardId);
    if (found) {
      navPush({ appMode: "cards", selectedCardId: found.card_id, selectedArticleId: null, selectedAccountId, cardViewDate, cardViewTab: "source" });
      setSelectedCardId(found.card_id);
      setPendingJumpCardId(null);
    }
  }, [cardList, pendingJumpCardId]);

  return (
    <div className="app-container">
      <Sidebar
        appMode={appMode}
        onAppModeChange={navSetAppMode}
        selectedAccountId={selectedAccountId}
        onSelectAccount={navSetAccount}
        cardViewDate={cardViewDate}
        onCardViewDateChange={navSetCardViewDate}
        cardDates={cardDates}
        isSidebarCollapsed={isSidebarCollapsed}
        sidebarWidth={sidebarWidth}
        onToggleSidebar={toggleSidebar}
        isAdminMode={isAdminMode}
        onToggleAdminMode={() => setIsAdminMode(v => !v)}
        currentUser={currentUser}
        onLogout={onLogout}
        appVersion={appVersion}
        canBack={canBack}
        canForward={canForward}
        onBack={handleBack}
        onForward={handleForward}
      />

      {/* Pane 2: Article List (articles mode) */}
      {appMode === "articles" && (
        <ArticleList
          articles={articles}
          selectedArticleId={selectedArticleId}
          onSelectArticle={navSelectArticle}
          onSelectAccount={navSetAccount}
          accountId={selectedAccountId}
          listWidth={listWidth}
          isLoading={isLoadingArticles}
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
          <AdminPane
            adminView={adminView}
            onAdminViewChange={setAdminView}
            activeArticle={activeArticle}
            articles={articles}
            currentUser={currentUser}
            onSelectArticle={setSelectedArticleId}
            onExitAdmin={() => setIsAdminMode(false)}
            isLoadingArticles={isLoadingArticles}
          />
        ) : activeArticle ? (
          <ArticleReader
            article={activeArticle}
            analysisStatus={analysisStatus}
            viewRaw={viewRaw}
            onViewRawChange={setViewRaw}
            isContentLoading={isContentLoading}
            onSelectAccount={jumpToAccount}
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
          <CardList
            cardViewDate={cardViewDate}
            listWidth={listWidth}
            selectedCardId={selectedCardId}
            onSelectCard={navSelectCard}
            cardViewTab={cardViewTab}
            onTabChange={setCardViewTab}
          />
          <div
            className={`resizer ${isResizingList ? 'resizing' : ''}`}
            onMouseDown={startResizeList}
          />
          {isAdminMode ? (
            <main className="reader-pane" style={{ overflow: 'hidden' }}>
              <AdminPane
                adminView={adminView}
                onAdminViewChange={setAdminView}
                activeArticle={activeArticle}
                articles={articles}
                currentUser={currentUser}
                onSelectArticle={setSelectedArticleId}
                onExitAdmin={() => setIsAdminMode(false)}
                isLoadingArticles={isLoadingArticles}
              />
            </main>
          ) : (
            <CardReader
              card={activeCard}
              onJumpToSource={jumpToSourceCard}
              onJumpToArticle={jumpToArticle}
              onSelectAccount={jumpToAccount}
              cardViewTab={cardViewTab}
              cardViewDate={cardViewDate}
              isAdmin={currentUser.role === "admin"}
            />
          )}
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

