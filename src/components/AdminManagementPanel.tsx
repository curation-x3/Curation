import { useState } from "react";
import { Trash2, RefreshCw, Loader2, Plus, CheckCircle } from "lucide-react";
import { SubscribeModal } from "./SubscribeModal";

const API_BASE = "http://127.0.0.1:8889";

interface Account {
  id: number;
  name: string;
  biz: string;
  avatar_url?: string;
  description?: string;
  last_monitored_at?: string;
  article_count?: number;
  subscription_type?: "subscribed" | "temporary";
}

interface Article {
  id: number;
  title: string;
  account?: string;
  publish_time?: string;
  serving_run_id?: number | null;
}

interface Props {
  accounts: Account[];
  articles: Article[];
  onRefresh: () => void;
  onSelectArticle: (articleId: number) => void;
}

export function AdminManagementPanel({ accounts, articles, onRefresh, onSelectArticle }: Props) {
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [syncMsgs, setSyncMsgs] = useState<Record<number, string>>({});
  const [deletingAccId, setDeletingAccId] = useState<number | null>(null);
  const [deletingArtId, setDeletingArtId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [isSubscribeOpen, setIsSubscribeOpen] = useState(false);

  const subscribedAccounts = accounts.filter(a => !a.subscription_type || a.subscription_type === 'subscribed');
  const temporaryAccounts = accounts.filter(a => a.subscription_type === 'temporary');

  const handleSyncAccount = async (acc: Account) => {
    setSyncingId(acc.id);
    try {
      const resp = await fetch(`${API_BASE}/accounts/${acc.id}/sync`, { method: "POST" }).then(r => r.json());
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
    try {
      await fetch(`${API_BASE}/accounts/${acc.id}`, { method: "DELETE" });
      onRefresh();
    } finally {
      setDeletingAccId(null);
    }
  };

  const handleDeleteArticle = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm("删除这篇文章？")) return;
    setDeletingArtId(id);
    try {
      await fetch(`${API_BASE}/articles/${id}`, { method: "DELETE" });
      onRefresh();
    } finally {
      setDeletingArtId(null);
    }
  };

  const filtered = articles.filter(a =>
    a.title?.toLowerCase().includes(search.toLowerCase()) ||
    a.account?.toLowerCase().includes(search.toLowerCase())
  );

  const renderAccountRow = (acc: Account) => (
    <div key={acc.id} style={{
      display: "flex", alignItems: "center", gap: 10,
      background: "#0d1117", borderRadius: 7, padding: "8px 10px",
    }}>
      {acc.avatar_url && (
        <img src={acc.avatar_url} alt="" referrerPolicy="no-referrer"
          style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#e6edf3", fontSize: "0.82rem", fontWeight: 500 }}>{acc.name}</div>
        <div style={{ color: "#8b949e", fontSize: "0.72rem" }}>
          {acc.article_count ?? 0} 篇文章
          {acc.last_monitored_at ? ` · 最后同步 ${new Date(acc.last_monitored_at).toLocaleDateString("zh-CN")}` : ""}
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

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "0 0 24px" }}>
      {/* Accounts section */}
      <div style={{ padding: "16px 20px 8px", borderBottom: "1px solid #21262d" }}>
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

      {/* Articles section */}
      <div style={{ padding: "16px 20px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: "0.72rem", color: "#8b949e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            文章列表（{articles.length}）
          </span>
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
          {filtered.map(art => (
            <div
              key={art.id}
              onClick={() => onSelectArticle(art.id)}
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
              {art.serving_run_id && (
                <span title="有分析版" style={{
                  display: "flex", alignItems: "center", gap: 3,
                  fontSize: "0.7rem", color: "#3fb950",
                  background: "#0d3019", borderRadius: 4, padding: "2px 6px",
                  flexShrink: 0,
                }}>
                  <CheckCircle size={11} /> 分析版
                </span>
              )}
              <button
                onClick={e => handleDeleteArticle(e, art.id)}
                disabled={deletingArtId === art.id}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#6e7681", padding: 4, borderRadius: 4, flexShrink: 0,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "#f85149")}
                onMouseLeave={e => (e.currentTarget.style.color = "#6e7681")}
              >
                {deletingArtId === art.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            </div>
          ))}
        </div>
      </div>

      <SubscribeModal
        open={isSubscribeOpen}
        onClose={() => setIsSubscribeOpen(false)}
        onSuccess={() => { setIsSubscribeOpen(false); onRefresh(); }}
      />
    </div>
  );
}
