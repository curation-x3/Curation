import { useState, useCallback } from "react";
import type { Card } from "../hooks/useCards";
import { apiFetch } from "../lib/api";

interface FlagModalProps {
  card: Card & { content?: string };
  cardType: "source" | "aggregated";
  onClose: () => void;
  onSuccess: () => void;
}

export function FlagModal({ card, cardType, onClose, onSuccess }: FlagModalProps) {
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!feedback.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await apiFetch("/api/admin/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: card.card_id, card_type: cardType, feedback }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({})) as { detail?: string };
        throw new Error(j.detail || `HTTP ${resp.status}`);
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }, [card.card_id, cardType, feedback, onSuccess]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#161b22", border: "1px solid #30363d", borderRadius: 10,
          padding: 24, width: 440, maxWidth: "90vw",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ color: "#e6edf3", fontWeight: 600, fontSize: "0.95rem" }}>标记问题</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#8b949e", padding: 4, fontSize: "1rem" }}
          >
            ✕
          </button>
        </div>
        <p style={{ color: "#8b949e", fontSize: "0.82rem", marginBottom: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {card.title}
        </p>
        <textarea
          autoFocus
          rows={4}
          placeholder="描述问题…（Cmd+Enter 提交）"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}
          style={{
            width: "100%", background: "#0d1117", border: "1px solid #30363d",
            borderRadius: 6, padding: "8px 10px", color: "#e6edf3",
            fontSize: "0.88rem", resize: "vertical", boxSizing: "border-box",
          }}
        />
        {error && (
          <p style={{ color: "#f85149", fontSize: "0.8rem", marginTop: 6 }}>{error}</p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              background: "none", border: "1px solid #30363d", borderRadius: 6,
              padding: "5px 14px", color: "#8b949e", cursor: "pointer", fontSize: "0.85rem",
            }}
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={submitting || !feedback.trim()}
            style={{
              background: feedback.trim() && !submitting ? "#1f6feb" : "#21262d",
              border: "none", borderRadius: 6, padding: "5px 14px",
              color: "#e6edf3", fontSize: "0.85rem",
              cursor: feedback.trim() && !submitting ? "pointer" : "default",
            }}
          >
            {submitting ? "提交中…" : "提交"}
          </button>
        </div>
      </div>
    </div>
  );
}
