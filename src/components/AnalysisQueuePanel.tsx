import { useState, useEffect } from "react";
import { RefreshCw, Play, ExternalLink } from "lucide-react";
import type { AgentManifest } from "../types";
import { apiFetch } from "../lib/api";

interface QueueEntry {
  id: number;
  article_id: number;
  article_title: string;
  request_count: number;
  status: "pending" | "running" | "done" | "failed";
  run_id: number | null;
  created_at: string;
  updated_at: string;
}

interface Strategy {
  auto_launch: boolean;
  max_concurrency: number;
  default_backend: string;
}

interface Props {
  onNavigateToArticle?: (articleId: number) => void;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  running: "处理中",
  done: "已完成",
  failed: "失败",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "#8b949e",
  running: "#f0a500",
  done: "#3fb950",
  failed: "#f85149",
};

export function AnalysisQueuePanel({ onNavigateToArticle }: Props) {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [strategy, setStrategy] = useState<Strategy>({ auto_launch: true, max_concurrency: 2, default_backend: "" });
  const [manifest, setManifest] = useState<AgentManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningArticles, setRunningArticles] = useState<Set<number>>(new Set());

  const fetchData = async () => {
    setLoading(true);
    try {
      const [qResp, sResp] = await Promise.all([
        apiFetch(`/queue`).then(r => r.json()),
        apiFetch(`/strategy`).then(r => r.json()),
      ]);
      if (qResp.status === "ok") setQueue(qResp.data);
      if (sResp.status === "ok") setStrategy(sResp.data);
    } finally {
      setLoading(false);
    }
  };

  // Fetch manifest for backend options
  useEffect(() => {
    apiFetch(`/agent/versions?n=1`)
      .then(r => r.json())
      .then(resp => {
        const vs = resp.data ?? [];
        if (vs.length > 0 && vs[0].manifest) {
          setManifest(vs[0].manifest);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, []);

  const patchStrategy = async (patch: Partial<Strategy>) => {
    const updated = { ...strategy, ...patch };
    setStrategy(updated);
    await apiFetch(`/strategy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  };

  const triggerRun = async (articleId: number) => {
    setRunningArticles(prev => new Set(prev).add(articleId));
    try {
      await apiFetch(`/queue/${articleId}/run`, { method: "POST" });
      await fetchData();
    } finally {
      setRunningArticles(prev => { const s = new Set(prev); s.delete(articleId); return s; });
    }
  };

  const backends = manifest ? Object.keys(manifest.backends) : [];

  return (
    <div style={{ padding: "18px 24px", overflowY: "auto", height: "100%" }}>
      {/* Strategy settings */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: "0.9rem", color: "#e6edf3" }}>执行策略</h3>
          <button
            onClick={fetchData}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#8b949e", display: "flex", alignItems: "center", gap: 4, fontSize: "0.75rem" }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
        </div>
        <div style={{
          background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
          padding: "14px 18px", display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap",
        }}>
          {/* Auto launch toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <div
              onClick={() => patchStrategy({ auto_launch: !strategy.auto_launch })}
              style={{
                width: 40, height: 22, borderRadius: 11, position: "relative", cursor: "pointer",
                background: strategy.auto_launch ? "#1f6feb" : "#30363d",
                transition: "background 0.2s",
              }}
            >
              <div style={{
                position: "absolute", top: 3, left: strategy.auto_launch ? 21 : 3,
                width: 16, height: 16, borderRadius: "50%", background: "#fff",
                transition: "left 0.2s",
              }} />
            </div>
            <span style={{ fontSize: "0.85rem", color: "#e6edf3" }}>自动拉起 Agent</span>
          </label>

          {/* Max concurrency */}
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "0.85rem", color: "#e6edf3" }}>最大并发数</span>
            <select
              value={strategy.max_concurrency}
              onChange={e => patchStrategy({ max_concurrency: Number(e.target.value) })}
              style={{
                background: "#21262d", border: "1px solid #30363d", borderRadius: 5,
                color: "#e6edf3", padding: "3px 8px", fontSize: "0.85rem", cursor: "pointer",
              }}
            >
              {[1, 2, 3, 4, 5].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>

          {/* Default backend */}
          {backends.length > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "0.85rem", color: "#e6edf3" }}>默认后端</span>
              <select
                value={strategy.default_backend}
                onChange={e => patchStrategy({ default_backend: e.target.value })}
                style={{
                  background: "#21262d", border: "1px solid #30363d", borderRadius: 5,
                  color: "#e6edf3", padding: "3px 8px", fontSize: "0.85rem", cursor: "pointer",
                }}
              >
                {backends.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {/* Queue table */}
      <h3 style={{ margin: "0 0 12px", fontSize: "0.9rem", color: "#e6edf3" }}>
        任务队列 <span style={{ color: "#8b949e", fontWeight: 400, fontSize: "0.8rem" }}>({queue.length} 条)</span>
      </h3>
      {queue.length === 0 ? (
        <div style={{ color: "#8b949e", fontSize: "0.85rem", padding: "20px 0" }}>队列为空</div>
      ) : (
        <div style={{ border: "1px solid #30363d", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ background: "#161b22", color: "#8b949e" }}>
                <th style={{ padding: "8px 14px", textAlign: "left", fontWeight: 500 }}>文章</th>
                <th style={{ padding: "8px 14px", textAlign: "center", fontWeight: 500, whiteSpace: "nowrap" }}>请求次数</th>
                <th style={{ padding: "8px 14px", textAlign: "center", fontWeight: 500 }}>状态</th>
                <th style={{ padding: "8px 14px", textAlign: "center", fontWeight: 500 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((entry, i) => (
                <tr
                  key={entry.id}
                  style={{
                    borderTop: i > 0 ? "1px solid #21262d" : "none",
                    background: i % 2 === 0 ? "#0d1117" : "transparent",
                  }}
                >
                  <td style={{ padding: "9px 14px", color: "#e6edf3", maxWidth: 340 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
                      {entry.article_title}
                      {onNavigateToArticle && (
                        <button
                          onClick={() => onNavigateToArticle(entry.article_id)}
                          title="跳转到文章"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#58a6ff", padding: 0, display: "flex" }}
                        >
                          <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "9px 14px", textAlign: "center", color: "#e6edf3" }}>
                    {entry.request_count}
                  </td>
                  <td style={{ padding: "9px 14px", textAlign: "center" }}>
                    <span style={{
                      color: STATUS_COLOR[entry.status] ?? "#8b949e",
                      background: (STATUS_COLOR[entry.status] ?? "#8b949e") + "22",
                      borderRadius: 4, padding: "2px 8px", fontSize: "0.78rem",
                    }}>
                      {STATUS_LABEL[entry.status] ?? entry.status}
                    </span>
                  </td>
                  <td style={{ padding: "9px 14px", textAlign: "center" }}>
                    {(entry.status === "pending" || entry.status === "failed") && (
                      <button
                        onClick={() => triggerRun(entry.article_id)}
                        disabled={runningArticles.has(entry.article_id)}
                        title="立即运行"
                        style={{
                          background: "#238636", border: "none", borderRadius: 4,
                          color: "#fff", padding: "3px 10px", cursor: "pointer",
                          fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: 4,
                          opacity: runningArticles.has(entry.article_id) ? 0.5 : 1,
                        }}
                      >
                        <Play size={11} />
                        运行
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
