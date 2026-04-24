import { useState } from "react";
import { Inbox, ChevronRight, ChevronDown, ShieldCheck, Trash2, Star, Settings } from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { useAccounts, useUnsubscribe, useResubscribe } from "../hooks/useAccounts";
import { useQueryClient } from "@tanstack/react-query";
import { AddMenu } from "./AddMenu";
import { SubscribeModal } from "./SubscribeModal";
import { AddArticleModal } from "./AddArticleModal";
import type { Account } from "../types";

interface SidebarProps {
  accounts: Account[];
  selectedView: "inbox" | "discarded" | "favorites" | "search" | "home";
  selectedBiz: string | null;
  unreadCounts: Record<string, number>;
  isSidebarCollapsed: boolean;
  isAdminMode: boolean;
  onSelectInbox: () => void;
  onSelectAccount: (biz: string) => void;
  onSelectDiscarded: () => void;
  onSelectFavorites: () => void;
  onToggleAdmin: () => void;
  userName: string;
  currentUser: { id: number; email: string; username: string; role: string };
  appVersion: string;
  sidebarWidth: number;
  onNavigateToCard?: (cardId: string) => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  accounts,
  selectedView,
  selectedBiz,
  unreadCounts,
  isSidebarCollapsed,
  isAdminMode,
  onSelectInbox,
  onSelectAccount,
  onSelectDiscarded,
  onSelectFavorites,
  onToggleAdmin,
  userName,
  currentUser,
  appVersion,
  sidebarWidth,

  onNavigateToCard,
  onOpenSettings,
}: SidebarProps) {
  const { data: fetchedAccounts = [] } = useAccounts();
  const queryClient = useQueryClient();
  const unsubscribe = useUnsubscribe();
  const resubscribe = useResubscribe();

  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isSubscribeOpen, setIsSubscribeOpen] = useState(false);
  const [isAddArticleOpen, setIsAddArticleOpen] = useState(false);
  const [isAccountListOpen, setIsAccountListOpen] = useState(true);
  const [isTempListOpen, setIsTempListOpen] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  // Use passed accounts or fetched ones
  const allAccounts = accounts.length > 0 ? accounts : fetchedAccounts;
  const subscribedAccounts = allAccounts.filter((a: Account) => !a.subscription_type || a.subscription_type === "subscribed");
  const temporaryAccounts = allAccounts.filter((a: Account) => a.subscription_type === "temporary");

  const totalUnread = typeof unreadCounts["total"] === "number" ? unreadCounts["total"] : 0;

  const handleUnsubscribe = (e: React.MouseEvent, accountId: number) => {
    e.stopPropagation();
    if (!confirm("确定取消订阅该公众号？已有文章数据不会删除。")) return;
    unsubscribe.mutate(accountId);
  };

  const handleResubscribe = (e: React.MouseEvent, accountId: number) => {
    e.stopPropagation();
    resubscribe.mutate(accountId);
  };

  return (
    <aside
      className={`sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}
      style={{ width: isSidebarCollapsed ? 72 : sidebarWidth }}
    >
      <div className="sidebar-header">
        <h2 className="sidebar-title">
          <Inbox size={20} />
          <span className="sidebar-brand">
            <span className="sidebar-brand-name">Curation</span>
            {!isSidebarCollapsed && (
              <span className="sidebar-brand-slogan">
                <span>值得读完的文章</span>
                <span>远比你以为的少</span>
              </span>
            )}
          </span>
        </h2>
      </div>

      <div className="account-list">
        {/* Inbox: all */}
        <div
          className={`account-item ${selectedView === "inbox" && selectedBiz === null ? "active" : ""}`}
          onClick={onSelectInbox}
          title="收件箱"
        >
          <div className="account-avatar" style={{ background: "var(--accent-gold)", display: "flex", alignItems: "center", justifyContent: "center", color: "#1a1208" }}>
            <Inbox size={18} />
          </div>
          {!isSidebarCollapsed && (
            <div className="account-info">
              <div className="account-name">全部卡片</div>
            </div>
          )}
          {totalUnread > 0 && (
            <span className="unread-badge">{totalUnread}</span>
          )}
        </div>

        {/* Favorites */}
        <div
          className={`account-item ${selectedView === "favorites" ? "active" : ""}`}
          onClick={onSelectFavorites}
          title="收藏"
        >
          <div className="account-avatar" style={{ background: "var(--bg-panel)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-gold)" }}>
            <Star size={16} fill="var(--accent-gold)" />
          </div>
          {!isSidebarCollapsed && (
            <div className="account-info">
              <div className="account-name">收藏</div>
            </div>
          )}
        </div>

        {/* Subscribed accounts — collapsible */}
        {subscribedAccounts.length > 0 && (
          <div
            className="account-item"
            onClick={() => setIsAccountListOpen(!isAccountListOpen)}
            title="公众号"
            style={{ cursor: "pointer" }}
          >
            <div className="account-avatar" style={{ background: "var(--bg-panel)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
              {isAccountListOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
            {!isSidebarCollapsed && (
              <div className="account-info">
                <div className="account-name">公众号 ({subscribedAccounts.length})</div>
              </div>
            )}
          </div>
        )}
        {isAccountListOpen && subscribedAccounts.map((acc) => {
          const count = unreadCounts[acc.biz] ?? 0;
          return (
            <div
              key={acc.id}
              className={`account-item ${selectedView === "inbox" && selectedBiz === acc.biz ? "active" : ""}`}
              onClick={() => onSelectAccount(acc.biz)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: "取消订阅", danger: true, onClick: () => handleUnsubscribe(e as any, acc.id) },
                  ],
                });
              }}
              title={isSidebarCollapsed ? acc.name : ""}
              style={{ paddingLeft: isSidebarCollapsed ? 18 : 32 }}
            >
              <img
                src={acc.avatar_url || "https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07xvMibqLuWicX7Y16H1xP81v6B0Sraia9zK0dYniamHwJxiaGvH6v97K8K1icYibib9eA/0"}
                alt={acc.name}
                className="account-avatar"
                referrerPolicy="no-referrer"
                style={{ width: 28, height: 28 }}
              />
              {!isSidebarCollapsed && (
                <div className="account-info">
                  <div className="account-name">{acc.name}</div>
                </div>
              )}
              {count > 0 && <span className="unread-badge">{count}</span>}
            </div>
          );
        })}

        {/* Temporary accounts — collapsible */}
        {temporaryAccounts.length > 0 && (
          <div
            className="account-item"
            onClick={() => setIsTempListOpen(!isTempListOpen)}
            title="临时文章"
            style={{ cursor: "pointer" }}
          >
            <div className="account-avatar" style={{ background: "var(--bg-panel)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
              {isTempListOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
            {!isSidebarCollapsed && (
              <div className="account-info">
                <div className="account-name">临时文章 ({temporaryAccounts.length})</div>
              </div>
            )}
          </div>
        )}
        {isTempListOpen && temporaryAccounts.map((acc) => {
          const count = unreadCounts[acc.biz] ?? 0;
          return (
            <div
              key={acc.id}
              className={`account-item ${selectedView === "inbox" && selectedBiz === acc.biz ? "active" : ""}`}
              onClick={() => onSelectAccount(acc.biz)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: "添加订阅", onClick: () => handleResubscribe(e as any, acc.id) },
                  ],
                });
              }}
              title={isSidebarCollapsed ? acc.name : ""}
              style={{ paddingLeft: isSidebarCollapsed ? 18 : 32 }}
            >
              <img
                src={acc.avatar_url || "https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07xvMibqLuWicX7Y16H1xP81v6B0Sraia9zK0dYniamHwJxiaGvH6v97K8K1icYibib9eA/0"}
                alt={acc.name}
                className="account-avatar"
                referrerPolicy="no-referrer"
                style={{ width: 28, height: 28 }}
              />
              {!isSidebarCollapsed && (
                <div className="account-info">
                  <div className="account-name">{acc.name}</div>
                </div>
              )}
              {count > 0 && <span className="unread-badge">{count}</span>}
            </div>
          );
        })}

        {/* Discarded */}
        <div
          className={`account-item ${selectedView === "discarded" ? "active" : ""}`}
          onClick={onSelectDiscarded}
          title="未推送"
          style={{ marginTop: 8 }}
        >
          <div className="account-avatar" style={{ background: "var(--bg-panel)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            <Trash2 size={16} />
          </div>
          {!isSidebarCollapsed && (
            <div className="account-info">
              <div className="account-name">未推送</div>
            </div>
          )}
        </div>
      </div>

      <div className="sidebar-footer" style={{ padding: "10px", borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: "8px", marginBottom: "10px", position: "relative" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <AddMenu
              open={isAddMenuOpen}
              onClose={() => setIsAddMenuOpen(false)}
              onSubscribe={() => { setIsAddMenuOpen(false); setIsSubscribeOpen(true); }}
              onAddArticle={() => { setIsAddMenuOpen(false); setIsAddArticleOpen(true); }}
            />
            <button
              className="primary-btn"
              style={{ width: "100%", height: "36px", fontSize: "var(--fs-lg)" }}
              onClick={() => setIsAddMenuOpen((v) => !v)}
              title="添加内容"
            >
              + {!isSidebarCollapsed && <span style={{ fontSize: "var(--fs-sm)", marginLeft: 4 }}>添加</span>}
            </button>
          </div>
          {!isSidebarCollapsed && currentUser.role === "admin" && !__IS_WEB__ && (
            <button
              className="btn-icon"
              style={{ background: isAdminMode ? "var(--accent-gold)" : "var(--bg-panel)" }}
              title="管理员模式"
              onClick={onToggleAdmin}
            >
              <ShieldCheck size={18} />
            </button>
          )}
        </div>
        {!isSidebarCollapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px" }}>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {userName}
            </span>
            {appVersion && <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)", flexShrink: 0 }}>v{appVersion}</span>}
            <button
              className="btn-icon"
              onClick={onOpenSettings}
              title="设置"
              style={{ padding: 4 }}
            >
              <Settings size={14} />
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
        accounts={allAccounts}
        onRefresh={() => { queryClient.invalidateQueries({ queryKey: ["accounts"] }); queryClient.invalidateQueries({ queryKey: ["inbox"] }); }}
        onNavigateToCard={onNavigateToCard}
      />
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </aside>
  );
}
