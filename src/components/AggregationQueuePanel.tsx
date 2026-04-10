import { useState, useMemo } from "react";
import { RefreshCw, Play, RotateCcw, Trash2, ArrowUp, ArrowDown, ChevronRight, ChevronDown } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AggregationQueueEntry, AggregationRunEntry, AggregationStrategy } from "../types";
import { apiFetch } from "../lib/api";

const STATUS_LABEL: Record<string, string> = {
  prereq: "等待中",
  pending: "待处理",
  running: "处理中",
  done: "已完成",
  failed: "失败",
};

const STATUS_COLOR: Record<string, string> = {
  prereq: "#8b949e",
  pending: "#8b949e",
  running: "#f0a500",
  done: "#3fb950",
  failed: "#f85149",
};

type SortField = "created_at" | "date" | "status" | "request_count";
type SortDir = "asc" | "desc";

export default function AggregationQueuePanel() {
  const queryClient = useQueryClient();

  const { data: queueData, isLoading: isLoadingQueue, isFetching } = useQuery({
    queryKey: ["aggregationQueue"],
    queryFn: async () => {
      const resp = await apiFetch("/aggregation-queue").then(r => r.json());
      return resp.status === "ok" ? (resp.data as AggregationQueueEntry[]) : [];
    },
    refetchInterval: 5000,
  });
  const queue = queueData ?? [];

  const { data: strategyData } = useQuery({
    queryKey: ["aggregationStrategy"],
    queryFn: async () => {
      const resp = await apiFetch("/aggregation-strategy").then(r => r.json());
      return resp.status === "ok" ? (resp.data as AggregationStrategy) : { auto_launch: true, max_concurrency: 1, default_backend: "" };
    },
    refetchInterval: 5000,
  });
  const strategy = strategyData ?? { auto_launch: true, max_concurrency: 1, default_backend: "" };

  const loading = isFetching;

  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set(["prereq", "pending", "running", "done", "failed"]));
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [entryRuns, setEntryRuns] = useState<AggregationRunEntry[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const invalidateQueue = () => {
    queryClient.invalidateQueries({ queryKey: ["aggregationQueue"] });
  };

  const patchStrategy = async (patch: Partial<AggregationStrategy>) => {
    const resp = await apiFetch("/aggregation-strategy", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then(r => r.json());
    if (resp.status === "ok") {
      queryClient.invalidateQueries({ queryKey: ["aggregationStrategy"] });
    }
  };

  const triggerRunMutation = useMutation({
    mutationFn: async ({ userId, date }: { userId: number; date: string }) => {
      await apiFetch(`/aggregation-queue/${userId}/${date}/run`, { method: "POST" });
    },
    onSuccess: () => invalidateQueue(),
  });

  const triggerRun = async (userId: number, date: string) => {
    await triggerRunMutation.mutateAsync({ userId, date });
  };

  const retryMutation = useMutation({
    mutationFn: async ({ userId, date }: { userId: number; date: string }) => {
      await apiFetch(`/aggregation-queue/${userId}/${date}/retry`, { method: "POST" });
    },
    onSuccess: () => invalidateQueue(),
  });

  const retryEntry = async (userId: number, date: string) => {
    await retryMutation.mutateAsync({ userId, date });
  };

  const deleteRunMutation = useMutation({
    mutationFn: async (runId: number) => {
      await apiFetch(`/aggregation-runs/${runId}`, { method: "DELETE" });
    },
    onSuccess: () => invalidateQueue(),
  });

  const deleteRun = async (runId: number) => {
    await deleteRunMutation.mutateAsync(runId);
  };

  const toggleExpand = async (userId: number, date: string) => {
    const key = `${userId}-${date}`;
    if (expandedEntry === key) {
      setExpandedEntry(null);
      return;
    }
    setExpandedEntry(key);
    setLoadingRuns(true);
    try {
      const resp = await apiFetch(`/aggregation-queue/${userId}/${date}/runs`).then(r => r.json());
      if (resp.status === "ok") setEntryRuns(resp.data);
    } finally {
      setLoadingRuns(false);
    }
  };

  const toggleStatus = (s: string) => {
    setStatusFilters(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const filteredQueue = useMemo(() => {
    let items = queue.filter(e => statusFilters.has(e.status));
    items.sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      const cmp = sortField === "request_count"
        ? (Number(av) - Number(bv))
        : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  }, [queue, statusFilters, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  const fmtTime = (s: string | null) => {
    if (!s) return "";
    const d = new Date(s);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const fmtElapsed = (s: number | null | undefined): string => {
    if (s == null) return "";
    if (s < 60) return `${s.toFixed(0)}s`;
    return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
  };

  if (isLoadingQueue) return <div style={{padding:'2rem',textAlign:'center',color:'#8b949e'}}>加载队列...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Strategy controls */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #30363d", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button className="btn-icon" onClick={() => invalidateQueue()} title="刷新" style={{ padding: 4 }}>
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>

        <label style={{ fontSize: "0.75rem", color: "#8b949e", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <span>自动调度</span>
          <button
            onClick={() => patchStrategy({ auto_launch: !strategy.auto_launch })}
            style={{
              width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
              background: strategy.auto_launch ? "#1f6feb" : "#484f58",
              position: "relative", transition: "background 0.2s",
            }}
          >
            <span style={{
              position: "absolute", top: 2, left: strategy.auto_launch ? 18 : 2,
              width: 16, height: 16, borderRadius: 8, background: "#fff",
              transition: "left 0.2s",
            }} />
          </button>
        </label>

        <label style={{ fontSize: "0.75rem", color: "#8b949e", display: "flex", alignItems: "center", gap: 4 }}>
          并发
          <select
            value={strategy.max_concurrency}
            onChange={e => patchStrategy({ max_concurrency: Number(e.target.value) })}
            style={{ fontSize: "0.75rem", background: "#21262d", color: "#c9d1d9", border: "1px solid #30363d", borderRadius: 4, padding: "2px 4px" }}
          >
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", gap: 4 }}>
          {Object.entries(STATUS_LABEL).map(([key, label]) => (
            <button
              key={key}
              onClick={() => toggleStatus(key)}
              style={{
                fontSize: "0.7rem", padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                background: "#21262d", color: STATUS_COLOR[key],
                border: statusFilters.has(key) ? `1.5px solid ${STATUS_COLOR[key]}` : "1px solid #30363d",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Queue table */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "#161b22", zIndex: 1 }}>
              <th style={{ width: 30 }} />
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 500 }}>用户</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => handleSort("date")}>
                日期 <SortIcon field="date" />
              </th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => handleSort("status")}>
                状态 <SortIcon field="status" />
              </th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 500 }}>等待至</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => handleSort("request_count")}>
                请求次数 <SortIcon field="request_count" />
              </th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => handleSort("created_at")}>
                入队时间 <SortIcon field="created_at" />
              </th>
              <th style={{ textAlign: "right", padding: "6px 8px", color: "#8b949e", fontWeight: 500 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredQueue.map(entry => {
              const entryKey = `${entry.user_id}-${entry.date}`;
              const isExpanded = expandedEntry === entryKey;
              return (
                <>
                  <tr key={entryKey} style={{ borderBottom: "1px solid #21262d" }}>
                    <td style={{ padding: "6px 4px", textAlign: "center", cursor: "pointer" }} onClick={() => toggleExpand(entry.user_id, entry.date)}>
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td style={{ padding: "6px 8px", color: "#c9d1d9" }}>{entry.username || entry.email || `User #${entry.user_id}`}</td>
                    <td style={{ padding: "6px 8px", color: "#c9d1d9" }}>{entry.date}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <span style={{ color: STATUS_COLOR[entry.status], fontSize: "0.72rem", fontWeight: 600 }}>
                        {STATUS_LABEL[entry.status] || entry.status}
                      </span>
                      {entry.error_msg && (
                        <span style={{ color: "#f85149", fontSize: "0.68rem", marginLeft: 6 }} title={entry.error_msg}>
                          ({entry.error_msg.slice(0, 30)}{entry.error_msg.length > 30 ? "\u2026" : ""})
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px", color: "#8b949e", fontSize: "0.72rem" }}>
                      {entry.status === "prereq" && entry.wait_until ? fmtTime(entry.wait_until) : ""}
                    </td>
                    <td style={{ padding: "6px 8px", color: "#8b949e", textAlign: "center" }}>{entry.request_count}</td>
                    <td style={{ padding: "6px 8px", color: "#8b949e" }}>{fmtTime(entry.created_at)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {(entry.status === "pending" || entry.status === "prereq") && (
                        <button
                          onClick={() => triggerRun(entry.user_id, entry.date)}
                          style={{ fontSize: "0.7rem", padding: "2px 8px", borderRadius: 4, border: "none", cursor: "pointer", background: "#238636", color: "#fff", marginRight: 4 }}
                        >
                          <Play size={10} style={{ marginRight: 2 }} />运行
                        </button>
                      )}
                      {(entry.status === "done" || entry.status === "failed") && (
                        <button
                          onClick={() => retryEntry(entry.user_id, entry.date)}
                          style={{ fontSize: "0.7rem", padding: "2px 8px", borderRadius: 4, border: "none", cursor: "pointer", background: "#1f6feb", color: "#fff" }}
                        >
                          <RotateCcw size={10} style={{ marginRight: 2 }} />重试
                        </button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${entryKey}-detail`}>
                      <td colSpan={8} style={{ padding: "8px 16px", background: "#0d1117" }}>
                        {loadingRuns ? (
                          <span style={{ color: "#8b949e", fontSize: "0.75rem" }}>加载中…</span>
                        ) : entryRuns.length === 0 ? (
                          <span style={{ color: "#8b949e", fontSize: "0.75rem" }}>暂无运行记录</span>
                        ) : (
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", padding: "4px 8px", color: "#8b949e" }}>Run ID</th>
                                <th style={{ textAlign: "left", padding: "4px 8px", color: "#8b949e" }}>Backend</th>
                                <th style={{ textAlign: "left", padding: "4px 8px", color: "#8b949e" }}>状态</th>
                                <th style={{ textAlign: "left", padding: "4px 8px", color: "#8b949e" }}>耗时</th>
                                <th style={{ textAlign: "left", padding: "4px 8px", color: "#8b949e" }}>时间</th>
                                <th style={{ textAlign: "right", padding: "4px 8px", color: "#8b949e" }}>操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entryRuns.map(run => (
                                <tr key={run.id} style={{ borderTop: "1px solid #21262d" }}>
                                  <td style={{ padding: "4px 8px", color: "#c9d1d9" }}>
                                    #{run.id}
                                    {entry.run_id === run.id && (
                                      <span style={{ marginLeft: 6, fontSize: "0.65rem", color: "#3fb950", border: "1px solid #3fb950", borderRadius: 3, padding: "0 4px" }}>
                                        当前
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ padding: "4px 8px", color: "#8b949e" }}>{run.backend}</td>
                                  <td style={{ padding: "4px 8px" }}>
                                    <span style={{ color: STATUS_COLOR[run.overall_status] || "#8b949e" }}>
                                      {STATUS_LABEL[run.overall_status] || run.overall_status}
                                    </span>
                                  </td>
                                  <td style={{ padding: "4px 8px", color: "#8b949e" }}>{fmtElapsed(run.elapsed_s)}</td>
                                  <td style={{ padding: "4px 8px", color: "#8b949e" }}>{fmtTime(run.created_at)}</td>
                                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                                    <button
                                      onClick={() => deleteRun(run.id)}
                                      style={{ background: "none", border: "none", cursor: "pointer", color: "#f85149", padding: 2 }}
                                      title="删除"
                                    >
                                      <Trash2 size={12} />
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
        {filteredQueue.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#484f58", fontSize: "0.85rem" }}>
            暂无聚合任务
          </div>
        )}
      </div>
    </div>
  );
}
