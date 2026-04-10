import { useState } from "react";
import { Trash2, RefreshCw, Loader2, Plus, CheckCircle, Play, AlertCircle, RotateCcw, Sparkles } from "lucide-react";
import { SubscribeModal } from "./SubscribeModal";

import { apiFetch } from "../lib/api";

interface Account {
  id: number;
  name: string;
  biz: string;
  avatar_url?: string;
  description?: string;
  last_monitored_at?: string;
  article_count?: number;
  subscription_type?: "subscribed" | "temporary";
  avg_daily_freq?: number;
  estimated_daily_cost?: number;
  total_cost?: number;
  sync_count?: number;
}

interface Article {
  short_id: string;
  title: string;
  account?: string;
  publish_time?: string;
  serving_run_id?: number | null;
  queue_status?: "pending" | "running" | "done" | "failed" | null;
}

interface Props {
  accounts: Account[];
  articles: Article[];
  onRefresh: () => void;
  onSelectArticle: (articleId: string) => void;
  isLoading?: boolean;
}

export function AdminManagementPanel({ accounts, articles, onRefresh, onSelectArticle, isLoading }: Props) {
  const [activeTab, setActiveTab] = useState<"accounts" | "articles">("accounts");
  const [filterAccountId, setFilterAccountId] = useState<number | null>(null);
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set(["none", "pending", "running", "failed", "done"]));
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [syncMsgs, setSyncMsgs] = useState<Record<number, string>>({});
  const [deletingAccId, setDeletingAccId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isSubscribeOpen, setIsSubscribeOpen] = useState(false);

  const subscribedAccounts = accounts.filter(a => !a.subscription_type || a.subscription_type === 'subscribed');
  const temporaryAccounts = accounts.filter(a => a.subscription_type === 'temporary');

  const handleSyncAccount = async (acc: Account) => {
    setSyncingId(acc.id);
    try {
      const resp = await apiFetch(`/accounts/${acc.id}/sync`, { method: "POST" }).then(r => r.json());
      setSyncMsgs(prev => ({
        ...prev,
        [acc.id]: resp.new_count > 0 ? `+${resp.new_count}篇` : "已最新",
      }));
      onRefresh();
    } catch {
      setSyncMsgs(prev => ({ ...prev, [acc.id]: "失败" }));
    } finally {
      setSyncingId(null);
    }
  };

  const handleDeleteAccount = async (acc: Account) => {
    if (!confirm(`删除公众号「${acc.name}」？文章将保留但不再关联。`)) return;
    setDeletingAccId(acc.id);
    setErrorMsg(null);
    try {
      const resp = await apiFetch(`/accounts/${acc.id}`, { method: "DELETE" });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setErrorMsg(data.detail || `删除失败 (${resp.status})`);
        return;
      }
      onRefresh();
    } catch {
      setErrorMsg("网络错误，删除失败");
    } finally {
      setDeletingAccId(null);
    }
  };

  const [enqueuingId, setEnqueuingId] = useState<string | null>(null);
  const [enqueuingAll, setEnqueuingAll] = useState(false);

  const handleEnqueue = async (e: React.MouseEvent, art: Article) => {
    e.stopPropagation();
    setEnqueuingId(art.short_id);
    try {
      await apiFetch(`/articles/${art.short_id}/request-analysis`, { method: "POST" });
      onRefresh();
    } catch {} finally {
      setEnqueuingId(null);
    }
  };

  const handleEnqueueAll = async () => {
    const toEnqueue = articles.filter(a =>
      a.serving_run_id == null && (!a.queue_status || a.queue_status === "failed")
    );
    if (toEnqueue.length === 0) return;
    if (!confirm(`将 ${toEnqueue.length} 篇未分析文章加入队列？`)) return;
    setEnqueuingAll(true);
    try {
      await apiFetch("/queue/enqueue-batch", {
        method: "POST",
        body: JSON.stringify({ article_ids: toEnqueue.map(a => a.short_id) }),
      });
      onRefresh();
    } catch (e) {
      console.error("Batch enqueue failed:", e);
    } finally {
      setEnqueuingAll(false);
    }
  };


  const renderAccountRow = (acc: Account) => (
    <div key={acc.id} style={{
      display: "flex", alignItems: "center", gap: 10,
      background: "#0d1117", borderRadius: 7, padding: "8px 10px",
    }}>
      {acc.avatar_url && (
        <img src={acc.avatar_url} alt="" referrerPolicy="no-referrer"
          style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => handleAccountClick(acc.id)}>
        <div style={{ color: "#e6edf3", fontSize: "0.82rem", fontWeight: 500 }}>{acc.name}</div>
        <div style={{ color: "#8b949e", fontSize: "0.72rem" }}>
          {acc.article_count ?? 0} 篇文章
          {acc.last_monitored_at ? ` · 最后同步 ${new Date(acc.last_monitored_at).toLocaleDateString("zh-CN")}` : ""}
          {acc.avg_daily_freq != null ? ` · ${acc.avg_daily_freq.toFixed(1)} 篇/天` : ""}
          {acc.estimated_daily_cost != null ? ` · 约 ¥${acc.estimated_daily_cost.toFixed(3)}/天` : ""}
        </div>
      </div>
      {syncMsgs[acc.id] && (
        <span style={{ fontSize: "0.72rem", color: syncMsgs[acc.id].startsWith("+") ? "#3fb950" : "#8b949e" }}>
          {syncMsgs[acc.id]}
        </span>
      )}
      {acc.subscription_type !== "temporary" && (
        <button
          onClick={() => handleSyncAccount(acc)}
          disabled={syncingId !== null}
          title="同步最新文章"
          style={{
            background: "none", border: "1px solid #30363d", borderRadius: 5,
            color: "#8b949e", padding: "4px 8px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem",
            opacity: syncingId !== null ? 0.4 : 1,
          }}
        >
          {syncingId === acc.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          同步
        </button>
      )}
      <button
        onClick={() => handleDeleteAccount(acc)}
        disabled={deletingAccId === acc.id}
        title="删除"
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#6e7681", padding: 4, borderRadius: 4,
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );

  const toggleStatus = (s: string) => {
    setStatusFilters(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const articleStatus = (a: Article): string => {
    if (a.queue_status === "running" || a.queue_status === "pending" || a.queue_status === "failed" || a.queue_status === "done") return a.queue_status;
    return "none";
  };

  const handleAccountClick = (accId: number) => {
    setFilterAccountId(accId);
    setActiveTab("articles");
  };

  const filteredArticles = articles.filter(a => {
    if (filterAccountId != null && !accounts.some(acc => acc.id === filterAccountId && acc.name === a.account)) return false;
    if (!statusFilters.has(articleStatus(a))) return false;
    if (search && !(a.title?.toLowerCase().includes(search.toLowerCase()) || a.account?.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  const filterAccountName = filterAccountId != null ? accounts.find(a => a.id === filterAccountId)?.name : null;

  if (isLoading) return <div style={{padding:'2rem',textAlign:'center',color:'#8b949e'}}>加载中...</div>;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {errorMsg && (
        <div style={{ margin: "10px 20px 0", padding: "8px 12px", background: "#3d1a1a", border: "1px solid #6e3535", borderRadius: 6, fontSize: "0.8rem", color: "#f85149", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {errorMsg}
          <button onClick={() => setErrorMsg(null)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", padding: 0, marginLeft: 8 }}>✕</button>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, padding: "12px 20px 8px" }}>
        <button onClick={() => setActiveTab("accounts")} style={{
          fontSize: "0.75rem", padding: "4px 12px", borderRadius: 5, border: "none", cursor: "pointer",
          background: activeTab === "accounts" ? "#1f6feb" : "#21262d",
          color: activeTab === "accounts" ? "#fff" : "#8b949e",
        }}>公众号列表</button>
        <button onClick={() => setActiveTab("articles")} style={{
          fontSize: "0.75rem", padding: "4px 12px", borderRadius: 5, border: "none", cursor: "pointer",
          background: activeTab === "articles" ? "#1f6feb" : "#21262d",
          color: activeTab === "articles" ? "#fff" : "#8b949e",
        }}>文章列表</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 0 24px" }}>

      {/* Accounts tab */}
      {activeTab === "accounts" && (
      <div style={{ padding: "8px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: "0.72rem", color: "#8b949e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            已订阅公众号
          </span>
          <button
            onClick={() => setIsSubscribeOpen(true)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              background: "#21262d", border: "1px solid #30363d", borderRadius: 5,
              color: "#60a5fa", fontSize: "0.75rem", padding: "4px 10px", cursor: "pointer",
            }}
          >
            <Plus size={12} /> 订阅
          </button>
        </div>

        {subscribedAccounts.length === 0 ? (
          <p style={{ color: "#4b5563", fontSize: "0.82rem", margin: "8px 0" }}>暂无订阅</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {subscribedAccounts.map(acc => renderAccountRow(acc))}
          </div>
        )}

        {temporaryAccounts.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: "0.68rem", color: "#6e7681", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              临时阅读
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {temporaryAccounts.map(acc => renderAccountRow(acc))}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Articles tab */}
      {activeTab === "articles" && (
      <div style={{ padding: "8px 20px 0" }}>
        {/* Filter bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          {filterAccountName && (
            <span style={{ fontSize: "0.72rem", color: "#58a6ff", background: "#0d1d33", borderRadius: 4, padding: "2px 8px", display: "flex", alignItems: "center", gap: 4 }}>
              {filterAccountName}
              <button onClick={() => setFilterAccountId(null)} style={{ background: "none", border: "none", color: "#58a6ff", cursor: "pointer", padding: 0, fontSize: "0.72rem" }}>✕</button>
            </span>
          )}
          {([["none", "未分析"], ["pending", "排队中"], ["running", "分析中"], ["done", "已完成"], ["failed", "失败"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => toggleStatus(key)} style={{
              fontSize: "0.68rem", padding: "2px 8px", borderRadius: 4, cursor: "pointer",
              border: statusFilters.has(key) ? "1px solid #30363d" : "1px solid transparent",
              background: statusFilters.has(key) ? "#21262d" : "transparent",
              color: statusFilters.has(key) ? "#e6edf3" : "#6e7681",
            }}>{label}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
          <span style={{ fontSize: "0.72rem", color: "#8b949e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>
            文章列表（{filteredArticles.length}）
          </span>
          {articles.some(a => a.serving_run_id == null && (!a.queue_status || a.queue_status === "failed")) && (
            <button
              onClick={handleEnqueueAll}
              disabled={enqueuingAll}
              style={{
                display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                background: "#238636", border: "none", borderRadius: 5,
                color: "#fff", padding: "4px 10px", cursor: "pointer",
                fontSize: "0.72rem", opacity: enqueuingAll ? 0.5 : 1,
              }}
            >
              {enqueuingAll ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              全部生成
            </button>
          )}
          <input
            type="text"
            placeholder="搜索..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: "#0d1117", border: "1px solid #30363d", borderRadius: 5,
              padding: "4px 10px", color: "#e6edf3", fontSize: "0.75rem",
              outline: "none", width: 140,
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {filteredArticles.map(art => {
            const qs = art.queue_status;
            const hasSummary = art.serving_run_id != null;
            const isActive = qs === "running" || qs === "pending";

            return (
              <div
                key={art.short_id}
                onClick={() => onSelectArticle(art.short_id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                  background: "#0d1117",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#161b22")}
                onMouseLeave={e => (e.currentTarget.style.background = "#0d1117")}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    color: "#e6edf3", fontSize: "0.82rem",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {art.title}
                  </div>
                  <div style={{ color: "#8b949e", fontSize: "0.72rem", marginTop: 2 }}>
                    {art.account} · {art.publish_time ? art.publish_time.slice(0, 10) : ""}
                  </div>
                </div>

                {/* Status indicator */}
                {qs === "running" && (
                  <span title="分析中" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: "0.7rem", color: "#58a6ff", background: "#0d1d33", borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>
                    <Loader2 size={11} className="animate-spin" /> 分析中
                  </span>
                )}
                {qs === "pending" && (
                  <span title="排队中" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: "0.7rem", color: "#8b949e", background: "#161b22", borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>
                    排队中
                  </span>
                )}
                {qs === "failed" && (
                  <span title="失败" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: "0.7rem", color: "#f85149", background: "#3d1a1a", borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>
                    <AlertCircle size={11} /> 失败
                  </span>
                )}
                {hasSummary && qs !== "running" && qs !== "pending" && (
                  <span title="有分析版" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: "0.7rem", color: "#3fb950", background: "#0d3019", borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>
                    <CheckCircle size={11} /> 分析版
                  </span>
                )}

                {/* Enqueue / re-generate button */}
                {!isActive && (
                  <button
                    onClick={e => handleEnqueue(e, art)}
                    disabled={enqueuingId === art.short_id}
                    title={hasSummary ? "重新生成" : qs === "failed" ? "重试" : "生成AI总结"}
                    style={{
                      display: "flex", alignItems: "center", gap: 3, flexShrink: 0,
                      background: "none", border: "1px solid #30363d", borderRadius: 5,
                      color: qs === "failed" ? "#f85149" : hasSummary ? "#8b949e" : "#3fb950",
                      padding: "3px 8px", cursor: "pointer", fontSize: "0.7rem",
                      opacity: enqueuingId === art.short_id ? 0.4 : 1,
                    }}
                  >
                    {enqueuingId === art.short_id ? <Loader2 size={11} className="animate-spin" /> :
                     qs === "failed" ? <RotateCcw size={11} /> : <Play size={11} />}
                    {hasSummary ? "重新生成" : qs === "failed" ? "重试" : "生成"}
                  </button>
                )}

              </div>
            );
          })}
        </div>
      </div>
      )}

      </div>{/* end scroll container */}

      <SubscribeModal
        open={isSubscribeOpen}
        onClose={() => setIsSubscribeOpen(false)}
        onSuccess={() => { setIsSubscribeOpen(false); onRefresh(); }}
      />
    </div>
  );
}
