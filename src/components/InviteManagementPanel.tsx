import { useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { apiFetch } from "../lib/api";

interface InviteCode {
  id: number;
  code: string;
  is_active: boolean;
  used_by_email: string | null;
  creator_email: string | null;
  created_at: string;
  used_at: string | null;
  expires_at: string | null;
}

export function InviteManagementPanel() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function fetchCodes() {
    setLoading(true);
    const resp = await apiFetch("/invites");
    if (resp.ok) setCodes(await resp.json());
    setLoading(false);
  }

  useEffect(() => { fetchCodes(); }, []);

  async function handleGenerate() {
    setGenerating(true);
    const resp = await apiFetch("/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count }),
    });
    if (resp.ok) await fetchCodes();
    setGenerating(false);
  }

  async function handleRevoke(code: string) {
    await apiFetch(`/invites/${code}`, { method: "DELETE" });
    await fetchCodes();
  }

  function handleCopy(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div style={{ padding: 20, color: "#e6edf3", fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>邀请码管理</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <label style={{ color: "#8b949e" }}>数量</label>
          <input
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            style={{
              width: 52,
              padding: "4px 8px",
              background: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: 6,
              color: "#e6edf3",
              fontSize: 13,
            }}
          />
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              padding: "6px 14px",
              background: "#238636",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {generating ? "生成中…" : "生成邀请码"}
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: "#8b949e" }}>加载中…</p>
      ) : codes.length === 0 ? (
        <p style={{ color: "#8b949e" }}>暂无邀请码</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#8b949e", borderBottom: "1px solid #30363d" }}>
              <th style={th}>邀请码</th>
              <th style={th}>状态</th>
              <th style={th}>使用者</th>
              <th style={th}>创建时间</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid #21262d" }}>
                <td style={td}>
                  <code style={{ fontSize: 12, color: "#58a6ff" }}>{c.code}</code>
                </td>
                <td style={td}>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 12,
                      fontSize: 11,
                      background: c.is_active ? "#1a3a1a" : "#2d2d2d",
                      color: c.is_active ? "#3fb950" : "#8b949e",
                    }}
                  >
                    {c.is_active ? "可用" : "已使用"}
                  </span>
                </td>
                <td style={{ ...td, color: "#8b949e" }}>{c.used_by_email || "—"}</td>
                <td style={{ ...td, color: "#8b949e" }}>
                  {c.created_at ? c.created_at.slice(0, 10) : "—"}
                </td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleCopy(c.code)}
                      title="复制"
                      style={iconBtn}
                    >
                      {copied === c.code ? (
                        <span style={{ fontSize: 11, color: "#3fb950" }}>✓</span>
                      ) : (
                        <Copy size={13} />
                      )}
                    </button>
                    {c.is_active && (
                      <button
                        onClick={() => handleRevoke(c.code)}
                        title="撤销"
                        style={{ ...iconBtn, color: "#f85149" }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 12px",
  fontWeight: 500,
  fontSize: 12,
};

const td: React.CSSProperties = {
  padding: "8px 12px",
};

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#8b949e",
  padding: 4,
  display: "flex",
  alignItems: "center",
};
