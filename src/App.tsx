import { useState, useEffect, useMemo } from "react";
import { useLayout } from "./hooks/useLayout";
import { useInbox, useDiscarded } from "./hooks/useInbox";
import { useAccounts } from "./hooks/useAccounts";
import type { InboxItem } from "./types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import 'highlight.js/styles/github-dark.css';
import { X, Sparkles } from 'lucide-react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { Sidebar } from './components/Sidebar';
import { AdminPane } from './components/AdminPane';
import { InboxList } from './components/InboxList';
import { ReaderPane } from './components/ReaderPane';
import { ArticleDrawer } from './components/ArticleDrawer';
import { LoginScreen } from './components/LoginScreen';
import { AuthCallback } from './components/AuthCallback';
import { useAuth } from './lib/authStore';
import { API_BASE, WS_BASE } from './lib/api';
import { authingClient } from './lib/authing';
import "./App.css";

// Boot info
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
    logout();
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
  // View state
  const [selectedView, setSelectedView] = useState<"inbox" | "temporary" | "discarded">("inbox");
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedDiscardedId, setSelectedDiscardedId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Layout
  const { isSidebarCollapsed, sidebarWidth, listWidth, isResizingList, startResizeList, toggleSidebar } = useLayout();
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminView, setAdminView] = useState<"management" | "analysis" | "queue" | "aggregation" | "invites" | "users">("management");
  const [notification, setNotification] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");

  // Data
  const { data: accounts = [] } = useAccounts();
  const { data: inboxItems, isLoading: isLoadingInbox } = useInbox(
    selectedView === "inbox" ? selectedAccountId : undefined,
    false,
  );
  const { data: discardedItems, isLoading: isLoadingDiscarded } = useDiscarded();

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  // Reset admin view when leaving admin mode
  useEffect(() => {
    if (!isAdminMode) setAdminView("management");
  }, [isAdminMode]);

  // Auto-dismiss notification after 5s
  useEffect(() => {
    if (!notification) return;
    const id = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(id);
  }, [notification]);

  // Compute unread counts from inbox data
  const unreadCounts = useMemo(() => {
    const counts: Record<number | string, number> = { total: 0 };
    if (!inboxItems) return counts;
    for (const item of inboxItems) {
      if (!item.read_at) {
        counts.total = (counts.total || 0) + 1;
        const accId = item.article_meta.account_id;
        if (accId != null) {
          counts[accId] = (counts[accId] || 0) + 1;
        }
      }
    }
    return counts;
  }, [inboxItems]);

  // Find selected inbox item
  const selectedItem: InboxItem | null = useMemo(() => {
    if (!selectedCardId || !inboxItems) return null;
    return inboxItems.find((i) => i.card_id === selectedCardId) ?? null;
  }, [selectedCardId, inboxItems]);

  // Find selected discarded item
  const selectedDiscardedItem = useMemo(() => {
    if (!selectedDiscardedId || !discardedItems) return null;
    return discardedItems.find((i) => i.article_id === selectedDiscardedId) ?? null;
  }, [selectedDiscardedId, discardedItems]);

  // Sibling cards (same article) for drawer
  const siblingCards = useMemo(() => {
    if (!selectedItem || !inboxItems) return [];
    return inboxItems.filter((i) => i.article_id === selectedItem.article_id);
  }, [selectedItem, inboxItems]);

  // Handlers
  function handleSelectInbox() {
    setSelectedView("inbox");
    setSelectedAccountId(null);
    setSelectedCardId(null);
    setSelectedDiscardedId(null);
  }

  function handleSelectAccount(accountId: number) {
    setSelectedView("inbox");
    setSelectedAccountId(accountId);
    setSelectedCardId(null);
  }

  function handleSelectTemporary() {
    setSelectedView("temporary");
    setSelectedAccountId(null);
    setSelectedCardId(null);
    setSelectedDiscardedId(null);
  }

  function handleSelectDiscarded() {
    setSelectedView("discarded");
    setSelectedCardId(null);
    setSelectedDiscardedId(null);
  }

  function handleListSelect(id: string, type: "card" | "discarded") {
    if (type === "card") {
      setSelectedCardId(id);
      setSelectedDiscardedId(null);
    } else {
      setSelectedDiscardedId(id);
      setSelectedCardId(null);
    }
  }

  function handleDrawerSelectCard(cardId: string) {
    setSelectedCardId(cardId);
    setIsDrawerOpen(false);
  }

  // Keyboard shortcut: Alt+← / Alt+→ (placeholder for nav history if needed later)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && isDrawerOpen) {
        setIsDrawerOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDrawerOpen]);

  const isDiscardedView = selectedView === "discarded";
  const currentSelectedId = isDiscardedView ? selectedDiscardedId : selectedCardId;

  return (
    <div className="app-container">
      <Sidebar
        accounts={accounts}
        selectedView={selectedView}
        selectedAccountId={selectedAccountId}
        unreadCounts={unreadCounts}
        isSidebarCollapsed={isSidebarCollapsed}
        isAdminMode={isAdminMode}
        onSelectInbox={handleSelectInbox}
        onSelectAccount={handleSelectAccount}
        onSelectTemporary={handleSelectTemporary}
        onSelectDiscarded={handleSelectDiscarded}
        onToggleCollapse={toggleSidebar}
        onToggleAdmin={() => setIsAdminMode((v) => !v)}
        onLogout={onLogout}
        userName={currentUser.email || currentUser.username}
        currentUser={currentUser}
        appVersion={appVersion}
        sidebarWidth={sidebarWidth}
      />

      {/* Pane 2: InboxList */}
      <InboxList
        items={isDiscardedView ? undefined : inboxItems}
        discardedItems={isDiscardedView ? discardedItems : undefined}
        isDiscardedView={isDiscardedView}
        selectedId={currentSelectedId}
        onSelect={handleListSelect}
        isLoading={isDiscardedView ? isLoadingDiscarded : isLoadingInbox}
        listWidth={listWidth}
      />

      {/* Resizer */}
      <div
        className={`resizer ${isResizingList ? "resizing" : ""}`}
        onMouseDown={startResizeList}
      />

      {/* Pane 3: Reader / Admin */}
      {isAdminMode ? (
        <main className="reader-pane" style={{ overflow: "hidden" }}>
          <AdminPane
            adminView={adminView}
            onAdminViewChange={setAdminView}
            activeArticle={null}
            articles={[]}
            currentUser={currentUser}
            onSelectArticle={() => {}}
            onExitAdmin={() => setIsAdminMode(false)}
          />
        </main>
      ) : (
        <ReaderPane
          selectedItem={selectedItem}
          selectedDiscardedItem={selectedDiscardedItem}
          isDiscardedView={isDiscardedView}
          onOpenDrawer={() => setIsDrawerOpen(true)}
        />
      )}

      {/* Article Drawer overlay */}
      <ArticleDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        item={selectedItem}
        siblingCards={siblingCards}
        onSelectCard={handleDrawerSelectCard}
      />

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
