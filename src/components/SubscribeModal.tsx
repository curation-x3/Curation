import { useState } from "react";
import { X, Loader2 } from "lucide-react";

const API_BASE = "http://127.0.0.1:8889";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function SubscribeModal({ open, onClose, onSuccess }: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  if (!open) return null;

  const handleSubscribe = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setMsg(null);
    try {
      const resp = await fetch(`${API_BASE}/accounts/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      }).then(r => r.json());
      if (resp.status === "ok") {
        setMsg({ type: "ok", text: `✅ 已订阅：${resp.data?.name || trimmed}` });
        setName("");
        onSuccess();
      } else {
        setMsg({ type: "err", text: `⚠️ ${resp.detail || "订阅失败"}` });
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
        padding: 24, width: 380, maxWidth: "90vw",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, color: "#e6edf3", fontSize: "1rem" }}>订阅公众号</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#8b949e", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <p style={{ color: "#8b949e", fontSize: "0.8rem", margin: "0 0 12px" }}>
          输入公众号名称（例：腾讯研究院）
        </p>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubscribe()}
            placeholder="公众号名称"
            autoFocus
            style={{
              flex: 1, background: "#0d1117", border: "1px solid #30363d",
              borderRadius: 6, padding: "8px 12px", color: "#e6edf3", fontSize: "0.85rem",
              outline: "none",
            }}
          />
          <button
            onClick={handleSubscribe}
            disabled={loading || !name.trim()}
            style={{
              background: "#1f6feb", color: "#fff", border: "none", borderRadius: 6,
              padding: "8px 14px", cursor: loading ? "default" : "pointer",
              fontSize: "0.85rem", opacity: loading || !name.trim() ? 0.6 : 1,
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            查询订阅
          </button>
        </div>

        {msg && (
          <p style={{
            marginTop: 12, fontSize: "0.8rem",
            color: msg.type === "ok" ? "#3fb950" : "#f85149",
          }}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
