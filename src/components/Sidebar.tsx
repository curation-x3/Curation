import type { View } from "../types";

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  onRefresh: () => void;
  loading: boolean;
  sourceCount: number;
  articleCount: number;
}

export default function Sidebar({
  currentView,
  onNavigate,
  onRefresh,
  loading,
  sourceCount,
  articleCount,
}: SidebarProps) {
  const navItems: { id: View; icon: string; label: string; count?: number }[] =
    [
      { id: "feed", icon: "📰", label: "Feed", count: articleCount },
      { id: "sources", icon: "🔗", label: "Sources", count: sourceCount },
      { id: "settings", icon: "⚙️", label: "Settings" },
    ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <h1>✦ Curation</h1>
        <p>AI-powered info feed</p>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item${currentView === item.id ? " active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className="nav-badge">{item.count}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          className="refresh-btn"
          onClick={onRefresh}
          disabled={loading}
          title="Fetch and curate content"
        >
          <span className={loading ? "spin" : ""}>⟳</span>
          {loading ? "Curating…" : "Curate Now"}
        </button>
      </div>
    </aside>
  );
}
