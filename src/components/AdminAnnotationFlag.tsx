import { useState } from "react";
import { Flag, X } from "lucide-react";
import { CardAnnotationPanel } from "./CardAnnotationPanel";
import { useCardAnnotationsSingle } from "../hooks/useFeedback";

export function AdminAnnotationFlag({ cardId }: { cardId: string }) {
  const [open, setOpen] = useState(false);
  const { data = [] } = useCardAnnotationsSingle(cardId, true);
  const count = data.length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="管理员标注"
        title={count > 0 ? `${count} 条标注` : "添加标注"}
        style={{
          position: "absolute",
          right: 20,
          bottom: 20,
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: count > 0 ? "var(--accent-gold-dim)" : "var(--bg-elevated, var(--bg-surface))",
          color: count > 0 ? "var(--accent-gold)" : "var(--text-muted)",
          border: "1px solid var(--border)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          zIndex: 50,
        }}
      >
        <Flag size={18} />
        {count > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: "var(--accent-red)",
              color: "white",
              borderRadius: 10,
              fontSize: 10,
              padding: "1px 5px",
              minWidth: 16,
              textAlign: "center",
              lineHeight: 1.4,
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
            background: "rgba(0,0,0,0.4)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-surface)",
              borderRadius: 12,
              width: "min(640px, 92vw)",
              maxHeight: "80vh",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              overflow: "auto",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: "var(--fs-base)" }}>管理员标注</div>
              <button
                onClick={() => setOpen(false)}
                aria-label="关闭"
                style={{
                  marginLeft: "auto",
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
