import { useState } from "react";
import { Inbox, ChevronLeft, ChevronRight, ChevronDown, Menu, ShieldCheck, LogOut, Trash2, UserMinus, UserPlus, Star } from "lucide-react";
import { useAccounts, useUnsubscribe, useResubscribe } from "../hooks/useAccounts";
import { useQueryClient } from "@tanstack/react-query";
import { AddMenu } from "./AddMenu";
import { SubscribeModal } from "./SubscribeModal";
import { AddArticleModal } from "./AddArticleModal";
import type { Account } from "../types";

interface SidebarProps {
  accounts: Account[];
  selectedView: "inbox" | "discarded" | "favorites";
  selectedAccountId: number | null;
  unreadCounts: Record<number | string, number>;
  isSidebarCollapsed: boolean;
  isAdminMode: boolean;
  onSelectInbox: () => void;
  onSelectAccount: (accountId: number) => void;
  onSelectDiscarded: () => void;
  onSelectFavorites: () => void;
  onToggleCollapse: () => void;
  onToggleAdmin: () => void;
  onBack?: () => void;
  onForward?: () => void;
  canBack?: boolean;
  canForward?: boolean;
  onLogout: () => void;
  userName: string;
  currentUser: { id: number; email: string; username: string; role: string };
  appVersion: string;
  sidebarWidth: number;
  favoritesCount: number;
  onNavigateToCard?: (cardId: string) => void;
}

export function Sidebar({
  accounts,
  selectedView,
  selectedAccountId,
  unreadCounts,
  isSidebarCollapsed,
  isAdminMode,
  onSelectInbox,
  onSelectAccount,
  onSelectDiscarded,
  onSelectFavorites,
  onToggleCollapse,
  onToggleAdmin,
  onBack,
  onForward,
  canBack,
  canForward,
  onLogout,
  userName,
  currentUser,
  appVersion,
  sidebarWidth,
  favoritesCount,
  onNavigateToCard,
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
          <span>收件箱</span>
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {onBack && (
            <button
              className="btn-icon"
              onClick={onBack}
              disabled={!canBack}
              title="后退 (Alt+←)"
              style={{ opacity: canBack ? 1 : 0.3, cursor: canBack ? "pointer" : "default" }}
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {onForward && (
            <button
              className="btn-icon"
              onClick={onForward}
              disabled={!canForward}
              title="前进 (Alt+→)"
              style={{ opacity: canForward ? 1 : 0.3, cursor: canForward ? "pointer" : "default" }}
            >
              <ChevronRight size={18} />
            </button>
          )}
          <button className="btn-icon" onClick={onToggleCollapse} title={isSidebarCollapsed ? "展开侧栏" : "收起侧栏"}>
            <Menu size={18} />
          </button>
        </div>
      </div>

      <div className="account-list">
        {/* Inbox: all */}
        <div
          className={`account-item ${selectedView === "inbox" && selectedAccountId === null ? "active" : ""}`}
          onClick={onSelectInbox}
          title="收件箱"
        >
          <div className="account-avatar" style={{ background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
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
          <div className="account-avatar" style={{ background: "#21262d", display: "flex", alignItems: "center", justifyContent: "center", color: "#e3b341" }}>
            <Star size={16} fill="#e3b341" />
          </div>
          {!isSidebarCollapsed && (
            <div className="account-info">
              <div className="account-name">收藏</div>
            </div>
          )}
          {favoritesCount > 0 && (
            <span className="unread-badge" style={{ background: "#e3b341", color: "#0d1117" }}>{favoritesCount}</span>
          )}
        </div>

        {/* Subscribed accounts — collapsible */}
        {!isSidebarCollapsed && subscribedAccounts.length > 0 && (
          <div
            style={{ padding: "4px 14px", fontSize: "0.72rem", color: "#6e7681", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, userSelect: "none" }}
            onClick={() => setIsAccountListOpen(!isAccountListOpen)}
          >
            {isAccountListOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>公众号 ({subscribedAccounts.length})</span>
          </div>
        )}
        {isAccountListOpen && subscribedAccounts.map((acc) => {
          const count = unreadCounts[acc.id] ?? 0;
          return (
            <div
              key={acc.id}
              className={`account-item ${selectedView === "inbox" && selectedAccountId === acc.id ? "active" : ""}`}
              onClick={() => onSelectAccount(acc.id)}
              title={isSidebarCollapsed ? acc.name : ""}
              style={{ paddingLeft: isSidebarCollapsed ? 18 : 32, position: "relative" }}
              onMouseEnter={(e) => {
                const btn = e.currentTarget.querySelector(".account-action-btn") as HTMLElement | null;
                if (btn) btn.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                const btn = e.currentTarget.querySelector(".account-action-btn") as HTMLElement | null;
                if (btn) btn.style.opacity = "0";
              }}
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
                  <div className="account-name" style={{ fontSize: "0.84rem" }}>{acc.name}</div>
                </div>
              )}
              {count > 0 && <span className="unread-badge">{count}</span>}
              {!isSidebarCollapsed && (
                <button
                  className="btn-icon account-action-btn"
                  title="取消订阅"
                  onClick={(e) => handleUnsubscribe(e, acc.id)}
                  style={{
                    opacity: 0, transition: "opacity 0.15s",
                    padding: 3, flexShrink: 0, background: "none",
                  }}
                >
                  <UserMinus size={13} style={{ color: "#f85149" }} />
                </button>
              )}
            </div>
          );
        })}

        {/* Temporary accounts — collapsible */}
        {!isSidebarCollapsed && temporaryAccounts.length > 0 && (
          <div
            style={{ padding: "4px 14px", fontSize: "0.72rem", color: "#6e7681", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, userSelect: "none", marginTop: 8 }}
            onClick={() => setIsTempListOpen(!isTempListOpen)}
          >
            {isTempListOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>临时文章 ({temporaryAccounts.length})</span>
          </div>
        )}
        {isTempListOpen && temporaryAccounts.map((acc) => {
          const count = unreadCounts[acc.id] ?? 0;
          return (
            <div
              key={acc.id}
              className={`account-item ${selectedView === "inbox" && selectedAccountId === acc.id ? "active" : ""}`}
              onClick={() => onSelectAccount(acc.id)}
              title={isSidebarCollapsed ? acc.name : ""}
              style={{ paddingLeft: isSidebarCollapsed ? 18 : 32, position: "relative" }}
              onMouseEnter={(e) => {
                const btn = e.currentTarget.querySelector(".account-action-btn") as HTMLElement | null;
                if (btn) btn.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                const btn = e.currentTarget.querySelector(".account-action-btn") as HTMLElement | null;
                if (btn) btn.style.opacity = "0";
              }}
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
                  <div className="account-name" style={{ fontSize: "0.84rem" }}>{acc.name}</div>
                </div>
              )}
              {count > 0 && <span className="unread-badge">{count}</span>}
              {!isSidebarCollapsed && (
                <button
                  className="btn-icon account-action-btn"
                  title="订阅此公众号"
                  onClick={(e) => handleResubscribe(e, acc.id)}
                  style={{
                    opacity: 0, transition: "opacity 0.15s",
                    padding: 3, flexShrink: 0, background: "none",
                  }}
                >
                  <UserPlus size={13} style={{ color: "#3fb950" }} />
                </button>
              )}
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
          <div className="account-avatar" style={{ background: "#21262d", display: "flex", alignItems: "center", justifyContent: "center", color: "#8b949e" }}>
            <Trash2 size={16} />
          </div>
          {!isSidebarCollapsed && (
            <div className="account-info">
              <div className="account-name">未推送</div>
            </div>
          )}
        </div>
      </div>

      <div className="sidebar-footer" style={{ padding: "10px", borderTop: "1px solid #30363d" }}>
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
              style={{ width: "100%", height: "36px", fontSize: "1.1rem" }}
              onClick={() => setIsAddMenuOpen((v) => !v)}
              title="添加内容"
            >
              + {!isSidebarCollapsed && <span style={{ fontSize: "0.82rem", marginLeft: 4 }}>添加</span>}
            </button>
          </div>
          {!isSidebarCollapsed && currentUser.role === "admin" && (
            <button
              className="btn-icon"
              style={{ background: isAdminMode ? "#1d4ed8" : "#21262d" }}
              title="管理员模式"
              onClick={onToggleAdmin}
            >
              <ShieldCheck size={18} />
            </button>
          )}
        </div>
        {!isSidebarCollapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px" }}>
            <span style={{ fontSize: "0.72rem", color: "#8b949e", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {userName}
            </span>
            {appVersion && <span style={{ fontSize: "0.68rem", color: "#484f58", flexShrink: 0 }}>v{appVersion}</span>}
            <button className="btn-icon" title="退出登录" onClick={onLogout} style={{ padding: 4 }}>
              <LogOut size={14} style={{ color: "#8b949e" }} />
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
    </aside>
  );
}
