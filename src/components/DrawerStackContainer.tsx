import { useEffect } from "react";
import { X, ChevronLeft } from "lucide-react";
import { useDrawerStack, type ViewTarget } from "../state/drawerStack";

function titleFor(target: ViewTarget): string {
  switch (target.kind) {
    case "card":         return "卡片";
    case "sourceCards":  return "原卡片";
    case "article":      return "原文";
  }
}

export function DrawerStackContainer() {
  const stack = useDrawerStack((s) => s.stack);
  const pop = useDrawerStack((s) => s.pop);
  const clear = useDrawerStack((s) => s.clear);

  const top = stack[stack.length - 1];
  const isOpen = !!top;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        pop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, pop]);

  if (!top) return null;

  return (
    <div className="drawer-overlay" onClick={clear}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()} style={{ overflow: "hidden" }}>
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            background: "var(--bg-base)",
            borderBottom: "1px solid var(--bg-panel)",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {stack.length > 1 && (
              <button
                type="button"
                onClick={pop}
                aria-label="返回"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  padding: 4,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <div style={{ fontWeight: 500, minWidth: 0 }}>{titleFor(top)}</div>
          </div>
          <button
            type="button"
            onClick={clear}
            aria-label="关闭"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={18} />
          </button>
        </header>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 0" }}>
          <div style={{ padding: "0 16px", color: "var(--text-muted)" }}>
            (view body for {top.kind} will be rendered here in Task 6)
          </div>
        </div>
      </div>
    </div>
  );
}
