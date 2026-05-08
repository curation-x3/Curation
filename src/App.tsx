import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLayout } from "./hooks/useLayout";
import { useInbox, useDiscarded, useIsFirstSync, useAnalyzingQueue } from "./hooks/useInbox";
import { useAccounts, usePrimeAccountsCache } from "./hooks/useAccounts";
import { usePrimeDiscoverableCache } from "./hooks/useDiscoverableAccounts";
import { useInitCache, useSyncManager } from "./hooks/useSync";
import type { InboxItem } from "./types";


import { useFavorites } from './hooks/useFavorites';
import type { FavoriteItem } from './types';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import 'highlight.js/styles/github-dark.css';
import { X, Sparkles } from 'lucide-react';
import { check, relaunch, getVersion } from './lib/platform/updater';
import { SidebarRail } from './components/SidebarRail';
import { SidebarDrawer } from './components/SidebarDrawer';
import { SubscriptionsDrawerBody } from './components/SubscriptionsDrawerBody';
import { AdminPane } from './components/AdminPane';
import { InboxList } from './components/InboxList';
import { ReaderPane } from './components/ReaderPane';
import { SearchList } from './components/SearchList';
import { MapShell } from './components/MapShell';
import { useSearch } from './hooks/useSearch';
import { ArticleDrawer } from './components/ArticleDrawer';
import { SourceCardsDrawer } from './components/SourceCardsDrawer';
import { LoginScreen } from './components/LoginScreen';
import { AuthCallback } from './components/AuthCallback';
import { useAuth } from './lib/authStore';
import { API_BASE, WS_BASE } from './lib/api';
import { authingClient } from './lib/authing';
import { useAppearance } from "./hooks/useAppearance";
import { useFontShortcuts } from "./hooks/useFontShortcuts";
import { SettingsDrawerBody } from "./components/SettingsDrawerBody";
import { startAcpListener } from "./lib/acp/listener";
import { useCardStatusStore, isInboxUnread } from "./lib/acp/cardStatusStore";
import { getAcpMaxAlive, setAcpMaxAlive } from "./lib/chat";
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
      'background:var(--accent-gold);color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px',
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
  const [state, setState] = useState<"idle" | "downloading" | "ready" | "relaunching" | "error">("idle");
  const [targetVersion, setTargetVersion] = useState<string | null>(null);
  const checkInFlightRef = useRef(false);
  const readyRef = useRef(false);

  useEffect(() => {
    const doCheck = async () => {
      if (checkInFlightRef.current || readyRef.current) return;
      checkInFlightRef.current = true;
      try {
        const u = await check();
        console.log('[updater] check result:', u ? `update available: ${u.version}` : 'up to date');
        if (u) {
          setTargetVersion(u.version);
          setState("downloading");
          console.log('[updater] downloading in background...');
          await u.downloadAndInstall();
          console.log('[updater] download complete, ready to relaunch');
          readyRef.current = true;
          setState("ready");
        } else {
          setState("idle");
        }
      } catch (e) {
        console.warn('[updater] check/download failed:', e);
        setState("idle");
      } finally {
        checkInFlightRef.current = false;
      }
    };
    doCheck();
    const timer = setInterval(doCheck, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  if (state !== "ready" && state !== "relaunching") return null;

  const label =
    state === "relaunching" ? "正在重启..." :
    `重启以更新到 ${targetVersion ?? "新版本"}`;

  const disabled = state !== "ready";

  return (
    <button
      disabled={disabled}
      onClick={async () => {
        if (disabled) return;
        setState("relaunching");
        try {
          await relaunch();
        } catch (e) {
          console.error('[updater] relaunch failed:', e);
          setState("ready");
        }
      }}
      style={{
      position: 'fixed', top: 12, right: 16, zIndex: 200,
      background: 'var(--accent-gold)', color: '#1a1208', border: 'none',
      borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
      fontSize: 'var(--fs-sm)', display: 'flex', alignItems: 'center', gap: 6,
      boxShadow: '0 2px 8px rgba(212,164,92,0.4)',
      opacity: disabled ? 0.72 : 1,
    }}>
      ↑ {label}
    </button>
  );
}

function App() {
  const { state: authState, logout } = useAuth();

  if (authState.status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "var(--bg-base)", color: "var(--text-muted)", fontSize: 14 }}>
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
    // Silently end Authing OIDC session in background (no redirect)
    authingClient.endSessionSilently();
  }

  return (
    <QueryClientProvider client={queryClient}>
      <UpdateBanner />
      <AppMain key={currentUser.id} currentUser={currentUser} onLogout={handleLogout} />
    </QueryClientProvider>
  );
}

function AppMain({ currentUser, onLogout }: {
  currentUser: { id: number; email: string; username: string; role: string; authing_sub?: string };
  onLogout: () => void;
}) {
  // Appearance (font system)
  const appearance = useAppearance();
  useFontShortcuts({ bump: appearance.bumpReaderSize, clear: appearance.resetReaderSize });
  // Drawer is now click-toggle only: subscriptions panel and settings
  // panel are both sticky; hover does nothing.
  const [drawerState, setDrawerState] = useState<"idle" | "subs" | "settings">("idle");

  const handleToggleSubs = () => {
    setDrawerState((s) => (s === "subs" ? "idle" : "subs"));
  };

  const handleToggleSettings = () => {
    setDrawerState((s) => (s === "settings" ? "idle" : "settings"));
  };

  const handleCloseDrawer = () => {
    setDrawerState("idle");
  };

  const [notesPath, setNotesPath] = useState(() => localStorage.getItem("notesPath") ?? "");
  const handleNotesPathChange = useCallback((path: string) => {
    setNotesPath(path);
    localStorage.setItem("notesPath", path);
  }, []);

  // View state
  const [selectedView, setSelectedView] = useState<"inbox" | "discarded" | "favorites" | "search" | "home" | "map">("inbox");
  const [selectedBiz, setSelectedBiz] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedDiscardedId, setSelectedDiscardedId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  /** When set, ArticleDrawer renders this article (override mode) — used by
   * SourceCardsDrawer to view a source's article without that source being
   * in the user's inbox. Null means use the inbox-card path (selectedItem). */
  const [overrideArticleId, setOverrideArticleId] = useState<string | null>(null);
  const [overrideArticleTitle, setOverrideArticleTitle] = useState<string | null>(null);
  const [overrideArticleUrl, setOverrideArticleUrl] = useState<string | null>(null);
  const [selectedFavorite, setSelectedFavorite] = useState<FavoriteItem | null>(null);
  const { data: favoritesData } = useFavorites();
  const search = useSearch();

  // Layout
  const { listWidth, isResizingList, startResizeList } = useLayout();
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminView, setAdminView] = useState<"management" | "queue" | "aggregation" | "map" | "invites" | "users" | "annotations">("management");
  const [notification, setNotification] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");

  // Cache & sync — use authing_sub as userId for key derivation
  const { cacheReady } = useInitCache(true, currentUser?.authing_sub ?? currentUser?.id?.toString() ?? null);
  // Gate sync/WS on cache being ready — prevents "not authenticated" errors
  // on cold startup after auto-update when Rust side hasn't received the token yet
  const { syncing } = useSyncManager(cacheReady);
  const isFirstSync = useIsFirstSync(syncing);

  // Data
  usePrimeAccountsCache(cacheReady);
  usePrimeDiscoverableCache(undefined, cacheReady);
  const { data: accounts = [] } = useAccounts();
  // Single local read — full inbox. Account filtering is applied client-side below.
  const { data: cachedInboxItems, isLoading: isLoadingInbox } = useInbox(undefined, false, cacheReady);
  const analyzingItems = useAnalyzingQueue();
  // Merge analyzing placeholders (card_id === null) for articles whose cards
  // haven't been synced yet. Skip entries whose article already has a card.
  const allInboxItems = useMemo(() => {
    if (!cachedInboxItems) return cachedInboxItems;
    const existingArticleIds = new Set(cachedInboxItems.map((i) => i.article_id));
    const fresh = analyzingItems.filter((a) => !existingArticleIds.has(a.article_id));
    return [...fresh, ...cachedInboxItems];
  }, [cachedInboxItems, analyzingItems]);
  // Filtered inbox for list display
  const inboxItems = useMemo(() => {
    if (!allInboxItems) return undefined;
    if (selectedView !== "inbox" || selectedBiz == null) return allInboxItems;
    return allInboxItems.filter((i) => i.article_meta.biz === selectedBiz);
  }, [allInboxItems, selectedView, selectedBiz]);
  const { data: discardedItems, isLoading: isLoadingDiscarded } = useDiscarded();

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  // Start ACP runtime event listener once (survives card switches).
  // Also re-apply saved max_alive so the backend reflects the persisted setting.
  useEffect(() => {
    startAcpListener().catch(() => {});
    getAcpMaxAlive()
      .then((n) => setAcpMaxAlive(n))
      .catch(() => {});
  }, []);

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

  // Compute unread counts from FULL inbox (not filtered by biz).
  // "Unread" = !read_at OR an unviewed ACP chat reply (see isInboxUnread).
  const acpByCard = useCardStatusStore((s) => s.byCard);
  const unreadCounts = useMemo(() => {
    const counts: Record<string, number> = { total: 0 };
    if (!allInboxItems) return counts;
    for (const item of allInboxItems) {
      if (isInboxUnread(item, acpByCard)) {
        counts.total = (counts.total || 0) + 1;
        const biz = item.article_meta.biz;
        if (biz) counts[biz] = (counts[biz] || 0) + 1;
      }
    }
    return counts;
  }, [allInboxItems, acpByCard]);

  // Find selected inbox item
  const selectedItem: InboxItem | null = useMemo(() => {
    if (!selectedCardId || !inboxItems) return null;
    // Try card_id match first (normal items)
    const byCard = inboxItems.find((i) => i.card_id === selectedCardId);
    if (byCard) return byCard;
    // Try article_id match (analyzing items have no card_id)
    return inboxItems.find((i) => !i.card_id && i.article_id === selectedCardId) ?? null;
  }, [selectedCardId, inboxItems]);

  // Auto-transition: when selected analyzing item gets a card, switch to it
  useEffect(() => {
    if (!selectedCardId || !inboxItems) return;
    // If current selection is a card_id that exists, nothing to do
    if (inboxItems.find((i) => i.card_id === selectedCardId)) return;
    // Check if a card appeared for this article_id (was analyzing, now has cards)
    const withCard = inboxItems.find((i) => i.card_id && i.article_id === selectedCardId);
    if (withCard && withCard.card_id) {
      setSelectedCardId(withCard.card_id);
    }
  }, [inboxItems, selectedCardId]);

  // Find selected discarded item
  const selectedDiscardedItem = useMemo(() => {
    if (!selectedDiscardedId || !discardedItems) return null;
    return discardedItems.find((i) => i.article_id === selectedDiscardedId) ?? null;
  }, [selectedDiscardedId, discardedItems]);

  // Convert selected favorite to InboxItem for ReaderPane reuse
  const favoriteAsInboxItem: InboxItem | null = useMemo(() => {
    if (!selectedFavorite || selectedFavorite.item_type !== "card") return null;
    const meta = selectedFavorite.article_meta ?? {
      title: selectedFavorite.article_title ?? selectedFavorite.title ?? "",
      account: selectedFavorite.article_account ?? "",
      biz: null,
      author: null,
      publish_time: null,
      url: "",
    };
    return {
      card_id: selectedFavorite.item_id,
      article_id: selectedFavorite.article_id ?? "",
      title: selectedFavorite.title ?? "",
      description: selectedFavorite.description,
      word_count: selectedFavorite.word_count ?? undefined,
      reading_minutes: selectedFavorite.reading_minutes ?? undefined,
      // Favorites endpoint doesn't yet carry entities; show empty rather
      // than block on a separate fetch. ReaderPane no-renders the chip
      // strip when entities is empty.
      entities: [],
      routing: selectedFavorite.routing,
      template: null,
      template_reason: null,
      card_date: null,
      read_at: selectedFavorite.created_at, // favorites are "read"
      queue_status: null,
      article_meta: meta,
    };
  }, [selectedFavorite]);

  // The item to show in ReaderPane — works for both inbox and favorites
  const activeReaderItem = selectedView === "favorites" ? favoriteAsInboxItem : selectedItem;

  // Convert all favorites to InboxItem[] for unified list rendering
  const favoritesAsInboxItems: InboxItem[] = useMemo(() => {
    if (!favoritesData) return [];
    return favoritesData
      .filter((f) => f.item_type === "card")
      .map((f): InboxItem => {
        const meta = f.article_meta ?? {
          title: f.article_title ?? f.title ?? "",
          account: f.article_account ?? "",
          biz: null,
          author: null,
          publish_time: null,
          url: "",
        };
        return {
          card_id: f.item_id,
          article_id: f.article_id ?? "",
          title: f.title ?? "",
          description: f.description,
          word_count: f.word_count ?? undefined,
          reading_minutes: f.reading_minutes ?? undefined,
          entities: [],
          routing: f.routing,
          template: null,
          template_reason: null,
          card_date: f.article_meta?.publish_time ?? null,
          read_at: f.created_at,
          queue_status: null,
          article_meta: meta,
        };
      });
  }, [favoritesData]);

  // Sibling cards (same article) for drawer
  const siblingCards = useMemo(() => {
    if (!selectedItem || !inboxItems) return [];
    return inboxItems.filter((i) => i.article_id === selectedItem.article_id);
  }, [selectedItem, inboxItems]);

  // Handlers
  function handleSelectInbox() {
    setSelectedView("inbox");
    setSelectedBiz(null);
    setSelectedCardId(null);
    setSelectedDiscardedId(null);
  }

  function handleSelectAccount(biz: string) {
    setSelectedView("inbox");
    // Click an already-selected account → deselect (back to all-inbox).
    setSelectedBiz((current) => (current === biz ? null : biz));
    setSelectedCardId(null);
  }

  function handleSelectDiscarded() {
    setSelectedView("discarded");
    setSelectedCardId(null);
    setSelectedDiscardedId(null);
  }

  function handleSelectFavorites() {
    setSelectedView("favorites");
    setSelectedCardId(null);
    setSelectedDiscardedId(null);
    setSelectedFavorite(null);
  }

  function handleSelectSearch() {
    setSelectedView("search");
    setSelectedCardId(null);
    setSelectedDiscardedId(null);
    setSelectedFavorite(null);
  }

  function handleSelectMap() {
    setSelectedView("map");
    setSelectedCardId(null);
    setSelectedBiz(null);
  }

  function handleSelectFavoriteItem(item: FavoriteItem) {
    setSelectedFavorite(item);
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

  function handleNavigateToCard(cardId: string) {
    setSelectedView("inbox");
    setSelectedBiz(null);
    setSelectedCardId(cardId);
    setSelectedDiscardedId(null);
    setIsAdminMode(false);
  }

  // Keyboard shortcut: Alt+← / Alt+→ (placeholder for nav history if needed later)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && isDrawerOpen) {
        setIsDrawerOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (selectedView === "search") {
          handleSelectInbox();
        } else {
          handleSelectSearch();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDrawerOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        handleToggleSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isDiscardedView = selectedView === "discarded";
  const currentSelectedId = isDiscardedView ? selectedDiscardedId : selectedCardId;

  return (
    <div className="app-container">
      <SidebarRail
        accounts={accounts}
        selectedView={selectedView}
        selectedBiz={selectedBiz}
        unreadCounts={unreadCounts}
        isAdminMode={isAdminMode}
        currentUserRole={currentUser.role}
        isSubsOpen={drawerState === "subs"}
        isSettingsOpen={drawerState === "settings"}
        onSelectInbox={handleSelectInbox}
        onSelectFavorites={handleSelectFavorites}
        onSelectDiscarded={handleSelectDiscarded}
        onSelectMap={handleSelectMap}
        onToggleAdmin={() => setIsAdminMode((v) => !v)}
        onToggleSubs={handleToggleSubs}
        onToggleSettings={handleToggleSettings}
        onNavigateToCard={handleNavigateToCard}
      />

      <SidebarDrawer
        open={drawerState !== "idle"}
        onClose={handleCloseDrawer}
      >
        {drawerState === "subs" && (
          <SubscriptionsDrawerBody
            accounts={accounts}
            selectedView={selectedView}
            selectedBiz={selectedBiz}
            unreadCounts={unreadCounts}
            userName={currentUser.email || currentUser.username}
            appVersion={appVersion}
            onSelectAccount={handleSelectAccount}
            onNavigateToCard={handleNavigateToCard}
          />
        )}
        {drawerState === "settings" && (
          <SettingsDrawerBody
            draft={appearance.draft}
            autoSize={appearance.autoSize}
            currentUserEmail={currentUser.email}
            notesPath={notesPath}
            appVersion={appVersion}
            onNotesPathChange={handleNotesPathChange}
            onChange={appearance.setDraft}
            onReset={appearance.resetDefaults}
            onLogout={onLogout}
          />
        )}
      </SidebarDrawer>

      {/* Atlas takeover: replaces both the list pane and reader pane entirely */}
      {selectedView === "map" ? (
        <MapShell />
      ) : (
      <>
      {/* Pane 2: List */}
      {selectedView === "search" ? (
        <SearchList
          query={search.query}
          onQueryChange={search.setQuery}
          results={search.results}
          isLoading={search.isLoading}
          selectedCardId={selectedCardId}
          onSelect={(cardId) => { setSelectedCardId(cardId); setSelectedDiscardedId(null); }}
          listWidth={listWidth}
        />
      ) : (
        <InboxList
          isFirstSync={!isDiscardedView && selectedView === "inbox" ? isFirstSync : false}
          items={
            isDiscardedView
              ? (discardedItems ?? []).map((d): InboxItem => ({
                  card_id: null,
                  article_id: d.article_id,
                  title: d.title,
                  description: null,
                  entities: [],
                  routing: null,
                  template: null,
                  template_reason: null,
                  card_date: d.card_date,
                  read_at: null,
                  queue_status: null,
                  article_meta: d.article_meta,
                }))
              : selectedView === "favorites"
                ? favoritesAsInboxItems
                : inboxItems
          }
          isDiscardedView={isDiscardedView}
          isFavoritesView={selectedView === "favorites"}
          selectedId={selectedView === "favorites"
            ? (selectedFavorite?.item_id ?? null)
            : currentSelectedId}
          onSelect={selectedView === "favorites"
            ? (id: string, _type: "card" | "discarded") => {
                const fav = (favoritesData ?? []).find((f) => f.item_id === id);
                if (fav) handleSelectFavoriteItem(fav);
              }
            : handleListSelect}
          isLoading={isDiscardedView ? isLoadingDiscarded : selectedView === "favorites" ? false : isLoadingInbox}
          listWidth={listWidth}
          favoriteCardIds={new Set(
            (favoritesData ?? [])
              .filter((f) => f.item_type === "card" && f.item_id)
              .map((f) => f.item_id)
          )}
          filterAccount={
            selectedView === "inbox" && selectedBiz
              ? {
                  biz: selectedBiz,
                  name:
                    accounts.find((a) => a.biz === selectedBiz)?.name ??
                    selectedBiz,
                }
              : null
          }
          onClearFilter={() => setSelectedBiz(null)}
        />
      )}

      {/* Resizer */}
      <div
        className={`resizer ${isResizingList ? "resizing" : ""}`}
        onMouseDown={startResizeList}
      />

      {/* Pane 3: Reader / Admin */}
      {isAdminMode && !__IS_WEB__ ? (
        <main className="reader-pane" style={{ overflow: "hidden" }}>
          <AdminPane
            adminView={adminView}
            onAdminViewChange={setAdminView}
            currentUser={currentUser}
            onExitAdmin={() => setIsAdminMode(false)}
          />
        </main>
      ) : (
        <ReaderPane
          selectedItem={activeReaderItem}
          selectedDiscardedItem={selectedDiscardedItem}
          isDiscardedView={isDiscardedView}
          isHomeView={selectedView === "home"}
          cacheReady={cacheReady}
          onOpenDrawer={() => setIsDrawerOpen(true)}
          onOpenSources={() => setIsSourcesOpen(true)}
          onOpenSubs={handleToggleSubs}
        />
      )}
      </>
      )}

      {/* Article Drawer overlay. In override mode (overrideArticleId set), the
          drawer fetches that article id directly and skips card-level chrome
          (siblings/favorites/description) since `item` is null. */}
      <ArticleDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setOverrideArticleId(null);
          setOverrideArticleTitle(null);
          setOverrideArticleUrl(null);
        }}
        item={overrideArticleId ? null : selectedItem}
        siblingCards={overrideArticleId ? [] : siblingCards}
        onSelectCard={handleDrawerSelectCard}
        articleIdOverride={overrideArticleId}
        articleTitleOverride={overrideArticleTitle}
        articleUrlOverride={overrideArticleUrl}
      />

      {/* Source Cards Drawer — shown for aggregated/residual cards instead of ArticleDrawer */}
      <SourceCardsDrawer
        cardId={selectedItem?.card_id ?? null}
        isOpen={isSourcesOpen}
        onClose={() => setIsSourcesOpen(false)}
        onOpenArticle={(articleId, articleTitle, articleUrl) => {
          setIsSourcesOpen(false);
          setOverrideArticleId(articleId);
          setOverrideArticleTitle(articleTitle ?? null);
          setOverrideArticleUrl(articleUrl ?? null);
          setIsDrawerOpen(true);
        }}
      />

      {/* Toast notification */}
      {notification && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 500,
          background: 'var(--bg-panel)', border: '1px solid var(--accent-green)',
          borderRadius: 10, padding: '12px 18px',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          animation: 'fadeIn 0.2s ease',
        }}>
          <Sparkles size={16} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
          <span style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-base)' }}>{notification}</span>
          <button onClick={() => setNotification(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, marginLeft: 4 }}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
