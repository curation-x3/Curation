import { useState } from "react";
import { Flag, ShieldCheck, X } from "lucide-react";
import { CardAnnotationPanel } from "./CardAnnotationPanel";
import { useCardAnnotationsSingle } from "../hooks/useFeedback";

type Variant = "floating" | "inline";

export function AdminAnnotationFlag({
  cardId,
  variant = "floating",
}: {
  cardId: string;
  variant?: Variant;
}) {
  const [open, setOpen] = useState(false);
  const { data = [] } = useCardAnnotationsSingle(cardId, true);
  const count = data.length;
  const hasAnnotations = count > 0;

  const triggerStyle: React.CSSProperties =
    variant === "floating"
      ? {
          position: "absolute",
          right: 20,
          bottom: 20,
          zIndex: 50,
          boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
        }
      : {
          display: "inline-flex",
          marginTop: 12,
        };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="管理员标注"
        title={hasAnnotations ? `${count} 条管理员标注` : "添加管理员标注"}
        style={{
          ...triggerStyle,
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 999,
          background: hasAnnotations ? "var(--accent-gold-dim)" : "var(--bg-raised)",
          color: hasAnnotations ? "var(--accent-gold)" : "var(--text-muted)",
          border: "1px solid var(--border)",
          cursor: "pointer",
          fontSize: "0.78rem",
          lineHeight: 1.4,
          display: "inline-flex",
        }}
      >
        <Flag size={14} />
        <span>管理员标注</span>
        {hasAnnotations && (
          <span
            style={{
              marginLeft: 2,
              background: "var(--accent-red)",
              color: "white",
              borderRadius: 10,
              fontSize: "0.68rem",
              padding: "0 6px",
              minWidth: 16,
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-panel)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              width: "min(640px, 92vw)",
              maxHeight: "80vh",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              overflow: "auto",
              boxShadow: "0 12px 36px rgba(0,0,0,0.45)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 10, gap: 10 }}>
              <ShieldCheck size={18} style={{ color: "var(--accent-gold)", flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "var(--fs-base)" }}>管理员标注</div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>
                  仅管理员可见 · 用于持续数据集构建
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="关闭"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  padding: 4,
                  display: "flex",
                }}
              >
                <X size={18} />
              </button>
            </div>
            <CardAnnotationPanel cardId={cardId} />
          </div>
        </div>
      )}
    </>
  );
}
