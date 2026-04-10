import { useState, useMemo } from "react";
import { RefreshCw, Play, ExternalLink, RotateCcw, Trash2, ArrowUp, ArrowDown, ChevronRight, ChevronDown } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentBackends } from "../types";
import { apiFetch } from "../lib/api";

interface QueueEntry {
  id: number;
  article_id: string;
  article_title: string;
  article_publish_time: string | null;
  serving_run_id: number | null;
  request_count: number;
  status: "pending" | "running" | "done" | "failed";
  run_id: number | null;
  created_at: string;
  updated_at: string;
}

interface RunEntry {
  id: number;
  article_id: string;
  backend: string;
  overall_status: string;
  elapsed_s: number | null;
  error_msg: string | null;
  created_at: string;
}

interface Strategy {
  auto_launch: boolean;
  max_concurrency: number;
  default_backend: string;
}

interface Props {
  onNavigateToArticle?: (articleId: string) => void;
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

type SortField = "created_at" | "request_count" | "status" | "article_publish_time";
type SortDir = "asc" | "desc";

/** Extract unique YYYY-MM-DD dates from publish_time values */
function extractPublishDates(entries: QueueEntry[]): string[] {
  const dates = new Set<string>();
  for (const e of entries) {
    if (e.article_publish_time) {
      const d = e.article_publish_time.slice(0, 10);
      if (d) dates.add(d);
    }
  }
  return Array.from(dates).sort().reverse();
}

function formatPublishTime(t: string | null): string {
  if (!t) return "—";
  // Handle ISO or "YYYY-MM-DD HH:MM:SS" formats
  const d = new Date(t.replace(" ", "T"));
  if (isNaN(d.getTime())) return t.slice(0, 16);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function formatQueueTime(t: string): string {
  const d = new Date(t.replace(" ", "T"));
  if (isNaN(d.getTime())) return t.slice(0, 16);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export function AnalysisQueuePanel({ onNavigateToArticle }: Props) {
  const queryClient = useQueryClient();

  const { data: queueData, isLoading: isLoadingQueue, isFetching } = useQuery({
    queryKey: ["analysisQueue"],
    queryFn: async () => {
      const resp = await apiFetch(`/queue`).then(r => r.json());
      return resp.status === "ok" ? (resp.data as QueueEntry[]) : [];
    },
    refetchInterval: 5000,
  });
  const queue = queueData ?? [];

  const { data: strategyData } = useQuery({
    queryKey: ["analysisStrategy"],
    queryFn: async () => {
      const resp = await apiFetch(`/strategy`).then(r => r.json());
      return resp.status === "ok" ? (resp.data as Strategy) : { auto_launch: true, max_concurrency: 2, default_backend: "" };
    },
    refetchInterval: 5000,
  });
  const strategy = strategyData ?? { auto_launch: true, max_concurrency: 2, default_backend: "" };

  const { data: backendsInfo } = useQuery({
    queryKey: ["analysisBackends"],
    queryFn: async () => {
      const resp = await apiFetch(`/agent/backends`).then(r => r.json());
      return (resp.data as AgentBackends) ?? null;
    },
    staleTime: 60 * 1000,
  });

  const loading = isFetching;

  const [runningArticles, setRunningArticles] = useState<Set<string>>(new Set());
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set(["pending", "running", "done", "failed"]));
  const [publishDateFilter, setPublishDateFilter] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);
  const [articleRuns, setArticleRuns] = useState<RunEntry[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const toggleStatus = (s: string) => {
    setStatusFilters(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "request_count" ? "desc" : "desc");
    }
  };

  const publishDates = useMemo(() => extractPublishDates(queue), [queue]);

  const filteredQueue = useMemo(() => {
    let items = queue.filter(e => statusFilters.has(e.status));
    if (publishDateFilter) {
      items = items.filter(e => e.article_publish_time?.startsWith(publishDateFilter));
    }
    items.sort((a, b) => {
      let cmp = 0;
      if (sortField === "request_count") {
        cmp = a.request_count - b.request_count;
      } else {
        const av = String(a[sortField] ?? "");
        const bv = String(b[sortField] ?? "");
        cmp = av.localeCompare(bv, undefined, { numeric: true });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  }, [queue, statusFilters, publishDateFilter, sortField, sortDir]);

  const invalidateQueue = () => {
    queryClient.invalidateQueries({ queryKey: ["analysisQueue"] });
  };

  const patchStrategy = async (patch: Partial<Strategy>) => {
    await apiFetch(`/strategy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    queryClient.invalidateQueries({ queryKey: ["analysisStrategy"] });
  };

  const triggerRunMutation = useMutation({
    mutationFn: async (articleId: string) => {
      await apiFetch(`/queue/${articleId}/run`, { method: "POST" });
    },
    onSuccess: () => invalidateQueue(),
  });

  const triggerRun = async (articleId: string) => {
    setRunningArticles(prev => new Set(prev).add(articleId));
    try {
      await triggerRunMutation.mutateAsync(articleId);
    } finally {
      setRunningArticles(prev => { const s = new Set(prev); s.delete(articleId); return s; });
    }
  };

  const retryMutation = useMutation({
    mutationFn: async (articleId: string) => {
      await apiFetch(`/queue/${articleId}/retry`, { method: "POST" });
    },
    onSuccess: () => invalidateQueue(),
  });

  const retryEntry = async (articleId: string) => {
    await retryMutation.mutateAsync(articleId);
  };

  const toggleExpand = async (articleId: string) => {
    if (expandedArticle === articleId) {
      setExpandedArticle(null);
      return;
    }
    setExpandedArticle(articleId);
    setLoadingRuns(true);
    try {
      const resp = await apiFetch(`/articles/${articleId}/runs`).then(r => r.json());
      if (resp.status === "ok") setArticleRuns(resp.data);
    } finally {
      setLoadingRuns(false);
    }
  };

  const deleteRun = async (runId: number) => {
    await apiFetch(`/runs/${runId}`, { method: "DELETE" });
    invalidateQueue();
    if (expandedArticle) {
      const resp = await apiFetch(`/articles/${expandedArticle}/runs`).then(r => r.json());
      if (resp.status === "ok") setArticleRuns(resp.data);
    }
  };

  const backends = backendsInfo ? Object.keys(backendsInfo.backends) : [];

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
  };

  const thSortable = (field: SortField, label: string, align: "left" | "center" = "center") => (
    <th
      onClick={() => toggleSort(field)}
      style={{
        padding: "8px 14px", textAlign: align, fontWeight: 500, whiteSpace: "nowrap",
        cursor: "pointer", userSelect: "none",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        {label}
        <SortIcon field={field} />
      </span>
    </th>
  );

  if (isLoadingQueue) return <div style={{padding:'2rem',textAlign:'center',color:'#8b949e'}}>加载队列...</div>;

  return (
    <div style={{ padding: "18px 24px", overflowY: "auto", height: "100%" }}>
      {/* Strategy settings */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: "0.9rem", color: "#e6edf3" }}>执行策略</h3>
          <button
            onClick={() => invalidateQueue()}
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

      {/* Filters row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "0.9rem", color: "#e6edf3" }}>
          任务队列 <span style={{ color: "#8b949e", fontWeight: 400, fontSize: "0.8rem" }}>({filteredQueue.length}/{queue.length})</span>
        </h3>
        {(Object.entries(STATUS_LABEL) as [string, string][]).map(([key, label]) => (
          <button key={key} onClick={() => toggleStatus(key)} style={{
            fontSize: "0.72rem", padding: "2px 8px", borderRadius: 4, cursor: "pointer",
            border: statusFilters.has(key) ? "1px solid #30363d" : "1px solid transparent",
            background: statusFilters.has(key) ? "#21262d" : "transparent",
            color: statusFilters.has(key) ? (STATUS_COLOR[key] ?? "#e6edf3") : "#6e7681",
          }}>{label}</button>
        ))}

        {/* Publish date filter */}
        {publishDates.length > 0 && (
          <select
            value={publishDateFilter}
            onChange={e => setPublishDateFilter(e.target.value)}
            style={{
              marginLeft: "auto",
              background: "#21262d", border: "1px solid #30363d", borderRadius: 5,
              color: "#e6edf3", padding: "2px 8px", fontSize: "0.78rem", cursor: "pointer",
            }}
          >
            <option value="">全部日期</option>
            {publishDates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
      </div>

      {filteredQueue.length === 0 ? (
        <div style={{ color: "#8b949e", fontSize: "0.85rem", padding: "20px 0" }}>队列为空</div>
      ) : (
        <div style={{ border: "1px solid #30363d", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ background: "#161b22", color: "#8b949e" }}>
                <th style={{ padding: "8px 4px", width: 28 }} />
                <th style={{ padding: "8px 14px", textAlign: "left", fontWeight: 500 }}>文章</th>
                {thSortable("article_publish_time", "发布时间")}
                {thSortable("status", "分析状态")}
                <th style={{ padding: "8px 14px", textAlign: "center", fontWeight: 500 }}>推送状态</th>
                {thSortable("request_count", "请求次数")}
                {thSortable("created_at", "入队时间")}
                <th style={{ padding: "8px 14px", textAlign: "center", fontWeight: 500 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredQueue.map((entry, i) => {
                const isExpanded = expandedArticle === entry.article_id;
                return (
                  <>
                    <tr
                      key={entry.id}
                      style={{
                        borderTop: i > 0 ? "1px solid #21262d" : "none",
                        background: i % 2 === 0 ? "#0d1117" : "transparent",
                      }}
                    >
                      <td
                        onClick={() => toggleExpand(entry.article_id)}
                        style={{ padding: "9px 4px", textAlign: "center", cursor: "pointer", color: "#8b949e" }}
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td style={{ padding: "9px 14px", color: "#e6edf3", maxWidth: 300 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
                          {entry.article_title}
                          {onNavigateToArticle && (
                            <button
                              onClick={() => onNavigateToArticle(entry.article_id)}
                              title="跳转到文章"
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#58a6ff", padding: 0, display: "flex", flexShrink: 0 }}
                            >
                              <ExternalLink size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "9px 14px", textAlign: "center", color: "#8b949e", whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                        {formatPublishTime(entry.article_publish_time)}
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
                        <span style={{
                          color: entry.serving_run_id ? "#3fb950" : "#8b949e",
                          background: entry.serving_run_id ? "#3fb95022" : "#8b949e22",
                          borderRadius: 4, padding: "2px 8px", fontSize: "0.78rem",
                        }}>
                          {entry.serving_run_id ? "已推送" : "未推送"}
                        </span>
                      </td>
                      <td style={{ padding: "9px 14px", textAlign: "center", color: "#e6edf3" }}>
                        {entry.request_count}
                      </td>
                      <td style={{ padding: "9px 14px", textAlign: "center", color: "#8b949e", whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                        {formatQueueTime(entry.created_at)}
                      </td>
                      <td style={{ padding: "9px 14px", textAlign: "center" }}>
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          {entry.status === "pending" && (
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
                          {(entry.status === "failed" || entry.status === "done") && (
                            <button
                              onClick={() => retryEntry(entry.article_id)}
                              title="重新分析"
                              style={{
                                background: "#1f6feb", border: "none", borderRadius: 4,
                                color: "#fff", padding: "3px 10px", cursor: "pointer",
                                fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: 4,
                              }}
                            >
                              <RotateCcw size={11} />
                              重新分析
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${entry.id}-runs`} style={{ borderTop: "none" }}>
                        <td colSpan={8} style={{ padding: 0, background: "#161b22" }}>
                          {loadingRuns ? (
                            <div style={{ padding: "12px 24px", color: "#8b949e", fontSize: "0.8rem" }}>加载中...</div>
                          ) : articleRuns.length === 0 ? (
                            <div style={{ padding: "12px 24px", color: "#8b949e", fontSize: "0.8rem" }}>无分析记录</div>
                          ) : (
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                              <thead>
                                <tr style={{ color: "#8b949e" }}>
                                  <th style={{ padding: "6px 14px", textAlign: "left", fontWeight: 500 }}>Run ID</th>
                                  <th style={{ padding: "6px 14px", textAlign: "center", fontWeight: 500 }}>Backend</th>
                                  <th style={{ padding: "6px 14px", textAlign: "center", fontWeight: 500 }}>状态</th>
                                  <th style={{ padding: "6px 14px", textAlign: "center", fontWeight: 500 }}>耗时</th>
                                  <th style={{ padding: "6px 14px", textAlign: "center", fontWeight: 500 }}>时间</th>
                                  <th style={{ padding: "6px 14px", textAlign: "center", fontWeight: 500 }}>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {articleRuns.map(run => (
                                  <tr key={run.id} style={{ borderTop: "1px solid #21262d" }}>
                                    <td style={{ padding: "6px 14px", color: "#e6edf3" }}>
                                      <span>#{run.id}</span>
                                      {run.id === entry.serving_run_id && (
                                        <span style={{
                                          marginLeft: 8, color: "#3fb950", fontSize: "0.72rem",
                                          background: "#3fb95022", borderRadius: 4, padding: "1px 6px",
                                        }}>
                                          当前推送
                                        </span>
                                      )}
                                    </td>
                                    <td style={{ padding: "6px 14px", textAlign: "center", color: "#e6edf3" }}>
                                      {run.backend}
                                    </td>
                                    <td style={{ padding: "6px 14px", textAlign: "center" }}>
                                      <span style={{
                                        color: STATUS_COLOR[run.overall_status] ?? "#8b949e",
                                        background: (STATUS_COLOR[run.overall_status] ?? "#8b949e") + "22",
                                        borderRadius: 4, padding: "2px 8px", fontSize: "0.74rem",
                                      }}>
                                        {STATUS_LABEL[run.overall_status] ?? run.overall_status}
                                      </span>
                                    </td>
                                    <td style={{ padding: "6px 14px", textAlign: "center", color: "#8b949e" }}>
                                      {run.elapsed_s != null ? `${run.elapsed_s.toFixed(1)}s` : "—"}
                                    </td>
                                    <td style={{ padding: "6px 14px", textAlign: "center", color: "#8b949e", whiteSpace: "nowrap" }}>
                                      {formatQueueTime(run.created_at)}
                                    </td>
                                    <td style={{ padding: "6px 14px", textAlign: "center" }}>
                                      <button
                                        onClick={() => deleteRun(run.id)}
                                        title="删除"
                                        style={{
                                          background: "none", border: "1px solid #30363d", borderRadius: 4,
                                          color: "#8b949e", padding: "3px 8px", cursor: "pointer",
                                          fontSize: "0.74rem", display: "inline-flex", alignItems: "center", gap: 4,
                                        }}
                                      >
                                        <Trash2 size={11} />
                                        删除
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
