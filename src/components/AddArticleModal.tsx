import { useState } from "react";
import { X, Loader2 } from "lucide-react";

import { apiFetch } from "../lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  accounts: { id: number; name: string; avatar_url?: string }[];
  onRefresh: () => void;
  onNavigateToCard?: (cardId: string) => void;
}

export function AddArticleModal({ open, onClose, onRefresh, onNavigateToCard }: Props) {
  const [url, setUrl] = useState("");
  const [subscribe, setSubscribe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  if (!open) return null;

  const handleAdd = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setMsg(null);
    try {
      const resp = await apiFetch(`/articles/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, subscribe }),
      }).then(r => r.json());
      if (resp.status === "ok") {
        if (!resp.new && resp.card_id) {
          // Existing article with card — jump to it
          setMsg({ type: "ok", text: "✅ 文章已在库中，正在跳转..." });
          onRefresh();
          setTimeout(() => {
            onClose();
            setUrl("");
            setMsg(null);
            onNavigateToCard?.(resp.card_id);
          }, 600);
        } else if (!resp.new) {
          // Existing article still analyzing
          setMsg({ type: "ok", text: "✅ 文章正在分析中" });
          onRefresh();
          setTimeout(() => { onClose(); setUrl(""); setMsg(null); }, 1200);
        } else {
          // New article added and enqueued
          setMsg({ type: "ok", text: "✅ 文章已添加，正在分析..." });
          onRefresh();
          setTimeout(() => { onClose(); setUrl(""); setMsg(null); }, 1200);
        }
      } else {
        setMsg({ type: "err", text: `⚠️ ${resp.detail || "添加失败"}` });
      }
    } catch {
      setMsg({ type: "err", text: "⚠️ 网络错误" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
    }} onClick={onClose}>
      <div style={{
        background: "#161b22", border: "1px solid #30363d", borderRadius: 12,
        padding: 24, width: 440, maxWidth: "90vw",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, color: "#e6edf3", fontSize: "1rem" }}>添加文章</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#8b949e", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <p style={{ color: "#8b949e", fontSize: "0.8rem", margin: "0 0 12px" }}>
          粘贴微信公众号文章链接，系统自动归类。
        </p>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            placeholder="https://mp.weixin.qq.com/s/..."
            autoFocus
            style={{
              flex: 1, background: "#0d1117", border: "1px solid #30363d",
              borderRadius: 6, padding: "8px 12px", color: "#e6edf3", fontSize: "0.85rem",
              outline: "none",
            }}
          />
          <button
            onClick={handleAdd}
            disabled={loading || !url.trim()}
            style={{
              background: "#1f6feb", color: "#fff", border: "none", borderRadius: 6,
              padding: "8px 14px", cursor: loading ? "default" : "pointer",
              fontSize: "0.85rem",
              opacity: loading || !url.trim() ? 0.6 : 1,
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            添加
          </button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={subscribe}
            onChange={e => setSubscribe(e.target.checked)}
            style={{ width: 14, height: 14, accentColor: "#1f6feb", cursor: "pointer" }}
          />
          <span style={{ fontSize: "0.82rem", color: "#8b949e" }}>同时订阅该文章所属公众号</span>
        </label>

        {msg && (
          <p style={{ marginTop: 12, fontSize: "0.8rem", color: msg.type === "ok" ? "#3fb950" : "#f85149" }}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
