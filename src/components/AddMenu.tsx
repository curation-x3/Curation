import { useEffect, useRef } from "react";
import { Rss, FileText } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubscribe: () => void;
  onAddArticle: () => void;
}

export function AddMenu({ open, onClose, onSubscribe, onAddArticle }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        left: 0,
        background: "#1c2128",
        border: "1px solid #30363d",
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        minWidth: 160,
        zIndex: 100,
      }}
    >
      <button
        onClick={onSubscribe}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          width: "100%", padding: "10px 14px",
          background: "none", border: "none", cursor: "pointer",
          color: "#e6edf3", fontSize: "var(--fs-base)", textAlign: "left",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "#21262d")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
      >
        <Rss size={15} style={{ color: "#60a5fa" }} />
        订阅公众号
      </button>
      <div style={{ height: 1, background: "#30363d" }} />
      <button
        onClick={onAddArticle}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          width: "100%", padding: "10px 14px",
          background: "none", border: "none", cursor: "pointer",
          color: "#e6edf3", fontSize: "var(--fs-base)", textAlign: "left",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "#21262d")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
      >
        <FileText size={15} style={{ color: "#60a5fa" }} />
        添加文章
      </button>
    </div>
  );
}
