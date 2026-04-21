import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Play, RotateCcw, Trash2, Star, RefreshCw, ArrowUp, ArrowDown, Lock, X } from "lucide-react";
import {
  fetchQueue, fetchStrategy, patchStrategy, fetchBackends,
  triggerQueueRun, retryQueueEntry, fetchArticleRuns, deleteRun, setServingRun,
  dismissQueueEntry,
} from "../lib/api";
import { ArticlePreviewDrawer } from "./ArticlePreviewDrawer";
import { RunDetailDrawer } from "./RunDetailDrawer";
import type { QueueEntry, RunEntry, AgentBackends } from "../types";

function fmtTime(t: string | null) {
  if (!t) return "—";
  return t.replace("T", " ").slice(5, 16);
}

function statusLabel(s: string, failReason?: string | null, retryCount?: number, lastErrorType?: string | null) {
  const m: Record<string, { text: string; color: string }> = {
    pending:  { text: "待处理", color: "var(--text-muted)" },
    running:  { text: "运行中", color: "var(--accent-gold)" },
    done:     { text: "完成",   color: "var(--accent-green)" },
    failed:   { text: "失败",   color: "var(--accent-red)" },
    locked:   { text: "已锁定", color: "var(--accent-green)" },
  };
  const v = m[s] ?? { text: s, color: "var(--text-muted)" };
  const retrying = s === "pending" && retryCount && retryCount > 0;
  const displayText = retrying ? `重试${retryCount}` : v.text;
  const displayColor = retrying ? "var(--accent-gold)" : v.color;
  const tooltip = retrying ? `${lastErrorType || "unknown"}: ${failReason || ""}` : (failReason || undefined);
  return <span title={tooltip} style={{ color: displayColor, fontSize: "var(--fs-sm)", cursor: tooltip ? "help" : undefined }}>{displayText}</span>;
}

function routingPill(routing: string | null) {
  if (!routing) {
    return <span style={{ background: "var(--bg-base)", color: "var(--text-faint)", padding: "1px 8px", borderRadius: 10, fontSize: "var(--fs-xs)" }}>未推送</span>;
  }
  const m: Record<string, { text: string; bg: string; color: string }> = {
    ai_curation:   { text: "AI梳理",  bg: "var(--bg-panel)", color: "var(--accent-green)" },
    original_push: { text: "原文推送", bg: "var(--bg-panel)", color: "var(--accent-green)" },
    discard:       { text: "丢弃",     bg: "var(--bg-panel)", color: "var(--accent-gold)" },
  };
  const v = m[routing] ?? { text: routing, bg: "var(--bg-base)", color: "var(--text-faint)" };
  return <span style={{ background: v.bg, color: v.color, padding: "1px 8px", borderRadius: 10, fontSize: "var(--fs-xs)" }}>{v.text}</span>;
}

function runStatusColor(s: string) {
  const m: Record<string, string> = { done: "var(--accent-green)", failed: "var(--accent-red)", running: "var(--accent-gold)", pending: "var(--text-muted)" };
  return m[s] ?? "var(--text-muted)";
}

type SortKey = "article_title" | "article_account" | "article_publish_time" | "status" | "routing" | "started_at" | "updated_at";

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "zh-Hans-CN");
}

export function ArticleQueuePanel() {
  const qc = useQueryClient();

  const { data: queue = [], refetch: refetchQueue, isFetching: queueFetching } = useQuery<QueueEntry[]>({ queryKey: ["articleQueue"], queryFn: fetchQueue, refetchInterval: 1000, staleTime: 500 });
  const { data: strategy } = useQuery({ queryKey: ["analysisStrategy"], queryFn: fetchStrategy, refetchInterval: 1000, staleTime: 500 });
  const { data: backendsData } = useQuery<AgentBackends>({ queryKey: ["analysisBackends"], queryFn: fetchBackends, staleTime: 60_000 });

  const invalidateRuns = (aid: string | null) => {
    qc.invalidateQueries({ queryKey: ["articleQueue"] });
    if (aid) qc.invalidateQueries({ queryKey: ["articleRuns", aid] });
  };

  const [statusFilter, setStatusFilter]     = useState<string>("all");
  const [routingFilter, setRoutingFilter]   = useState<string>("all");
  const [dateFilter, setDateFilter]         = useState<string>("");
  const [sortKey, setSortKey]               = useState<SortKey>("updated_at");
  const [sortDir, setSortDir]               = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId]         = useState<string | null>(null);

  const [previewArticleId, setPreviewArticleId] = useState<string | null>(null);
  const [previewRouting, setPreviewRouting]      = useState<string | null>(null);
  const [detailRunId, setDetailRunId]            = useState<number | null>(null);

  const { data: articleRuns = [], isLoading: loadingRuns } = useQuery<RunEntry[]>({
    queryKey: ["articleRuns", expandedId],
    queryFn: () => fetchArticleRuns(expandedId!),
    enabled: !!expandedId,
  });

  const triggerMut  = useMutation({ mutationFn: (aid: string) => triggerQueueRun(aid), onSuccess: (_d, aid) => invalidateRuns(aid) });
  const retryMut    = useMutation({ mutationFn: (aid: string) => retryQueueEntry(aid), onSuccess: (_d, aid) => invalidateRuns(aid) });
  const deleteMut   = useMutation({ mutationFn: (rid: number) => deleteRun(rid), onSuccess: () => invalidateRuns(expandedId) });
  const servingMut  = useMutation({ mutationFn: ({ aid, rid }: { aid: string; rid: number }) => setServingRun(aid, rid), onSuccess: (_d, v) => invalidateRuns(v.aid) });
  const dismissMut  = useMutation({ mutationFn: (aid: string) => dismissQueueEntry(aid), onSuccess: () => invalidateRuns(null) });

  const patchStrat = (key: string, value: unknown) => {
    patchStrategy({ [key]: value }).then(() => qc.invalidateQueries({ queryKey: ["analysisStrategy"] }));
  };

  const filtered = queue.filter((e) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (routingFilter !== "all") {
      if (routingFilter === "none") { if (e.routing) return false; }
      else if (e.routing !== routingFilter) return false;
    }
    if (dateFilter) {
      if (!e.article_publish_time) return false;
      if (!e.article_publish_time.startsWith(dateFilter)) return false;
    }
    return true;
  }).slice().sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    return cmp((a as any)[sortKey], (b as any)[sortKey]) * dir;
  });

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const backendList = backendsData ? Object.keys(backendsData.backends ?? {}) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* System status bar */}
      {strategy && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 16px", borderBottom: "1px solid var(--bg-panel)", background: "var(--bg-base)", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
          {(() => {
            const counts: Record<string, number> = {};
            for (const e of queue) counts[e.status] = (counts[e.status] || 0) + 1;
            const retrying = queue.filter(e => e.retry_count > 0 && e.status === "pending").length;
            return (
              <>
                <span>共 {queue.length}</span>
                <span style={{ color: "var(--border)" }}>|</span>
                {counts.pending ? <span>待处理 <b style={{ color: "var(--text-primary)" }}>{counts.pending}</b></span> : null}
                {counts.running ? <span style={{ color: "var(--accent-gold)" }}>运行中 <b>{counts.running}</b></span> : null}
                {counts.done ? <span style={{ color: "var(--accent-green)" }}>完成 <b>{counts.done}</b></span> : null}
                {counts.failed ? <span style={{ color: "var(--accent-red)" }}>失败 <b>{counts.failed}</b></span> : null}
                {counts.locked ? <span>锁定 <b>{counts.locked}</b></span> : null}
                {retrying > 0 && <span style={{ color: "var(--accent-gold)" }}>重试中 <b>{retrying}</b></span>}
                <div style={{ flex: 1 }} />
                {strategy.system_paused && (
                  <span style={{ color: "var(--accent-red)", fontWeight: 600 }}>
                    系统暂停中 — 剩余 {Math.ceil(strategy.system_pause_remaining_s / 60)} 分钟
                  </span>
                )}
                {!strategy.system_paused && strategy.auto_launch && (
                  <span style={{ color: "var(--accent-green)" }}>调度运行中</span>
                )}
                {!strategy.auto_launch && (
                  <span style={{ color: "var(--text-faint)" }}>调度已关闭</span>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Controls bar */}
      {strategy && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", borderBottom: "1px solid var(--bg-panel)", background: "var(--bg-panel)", flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
          <span style={{ color: "var(--text-muted)" }}>自动启动</span>
          <button
            onClick={() => patchStrat("auto_launch", !strategy.auto_launch)}
            style={{ background: strategy.auto_launch ? "var(--accent-green)" : "var(--border)", color: "#fff", border: "none", borderRadius: 10, padding: "1px 10px", cursor: "pointer", fontSize: "var(--fs-xs)" }}
          >{strategy.auto_launch ? "开" : "关"}</button>

          <span style={{ color: "var(--border)" }}>|</span>
          <span style={{ color: "var(--text-muted)" }}>并发</span>
          <select value={strategy.max_concurrency} onChange={(e) => patchStrat("max_concurrency", +e.target.value)}
            style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 4px", fontSize: "var(--fs-sm)" }}>
            {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>

          <span style={{ color: "var(--border)" }}>|</span>
          <span style={{ color: "var(--text-muted)" }}>后端</span>
          <select value={strategy.default_backend} onChange={(e) => patchStrat("default_backend", e.target.value)}
            style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 4px", fontSize: "var(--fs-sm)" }}>
            {backendList.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>

          <div style={{ flex: 1 }} />

          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", fontSize: "var(--fs-xs)" }}>
            <option value="all">全部状态</option>
            <option value="pending">待处理</option>
            <option value="running">运行中</option>
            <option value="done">完成</option>
            <option value="failed">失败</option>
            <option value="locked">已锁定</option>
          </select>

          <select value={routingFilter} onChange={(e) => setRoutingFilter(e.target.value)}
            style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", fontSize: "var(--fs-xs)" }}>
            <option value="all">全部推送</option>
            <option value="ai_curation">AI梳理</option>
            <option value="original_push">原文推送</option>
            <option value="discard">丢弃</option>
            <option value="none">未推送</option>
          </select>

          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
            style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px", fontSize: "var(--fs-xs)" }} />
          {dateFilter && (
            <button onClick={() => setDateFilter("")} title="清除日期"
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0 2px", fontSize: "var(--fs-xs)" }}>×</button>
          )}

          <button onClick={() => refetchQueue()} title="刷新"
            disabled={queueFetching}
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 4, padding: "2px 6px", cursor: queueFetching ? "default" : "pointer", display: "flex", alignItems: "center" }}>
            <RefreshCw size={12} style={queueFetching ? { animation: "spin 1s linear infinite" } : undefined} />
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1fr) 110px 90px 80px 80px 90px 90px 80px", padding: "6px 16px", borderBottom: "1px solid var(--bg-panel)", background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: "var(--fs-xs)", fontWeight: 500, position: "sticky", top: 0, zIndex: 1 }}>
          {([
            ["article_title", "文章标题"],
            ["article_account", "公众号"],
            ["article_publish_time", "发布时间"],
            ["status", "任务状态"],
            ["routing", "推送状态"],
            ["started_at", "开始执行"],
            ["updated_at", "最后入队"],
          ] as [SortKey, string][]).map(([k, label]) => (
            <span key={k} onClick={() => toggleSort(k)}
              style={{ cursor: "pointer", userSelect: "none", display: "inline-flex", alignItems: "center", gap: 2 }}>
              {label}
              {sortKey === k && (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
            </span>
          ))}
          <span style={{ textAlign: "center" }}>操作</span>
        </div>

        {filtered.map((entry) => {
          const isExpanded = expandedId === entry.article_id;
          return (
            <div key={entry.article_id} style={{ borderBottom: "1px solid var(--bg-panel)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1fr) 110px 90px 80px 80px 90px 90px 80px", padding: "8px 16px", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                  <span
                    onClick={() => setExpandedId(isExpanded ? null : entry.article_id)}
                    style={{ cursor: "pointer", color: "var(--text-muted)", flexShrink: 0, width: 16 }}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  {entry.is_locked && (
                    <Lock size={12} style={{ color: "var(--accent-gold)", flexShrink: 0 }} />
                  )}
                  <a
                    onClick={() => { setPreviewArticleId(entry.article_id); setPreviewRouting(entry.routing); }}
                    style={{ color: "var(--accent-blue)", cursor: "pointer", textDecoration: "none", fontSize: "var(--fs-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {entry.article_title}
                  </a>
                  <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-xs)", flexShrink: 0 }}>{entry.run_count} runs</span>
                </div>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.article_account ?? "—"}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>{fmtTime(entry.article_publish_time)}</span>
                {statusLabel(entry.status, entry.fail_reason, entry.retry_count, entry.last_error_type)}
                {routingPill(entry.routing)}
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>{fmtTime(entry.started_at)}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>{fmtTime(entry.updated_at)}</span>
                <div style={{ display: "flex", justifyContent: "center", gap: 2 }}>
                  {entry.status === "pending" && !entry.is_locked && (
                    <button onClick={() => triggerMut.mutate(entry.article_id)} title="触发运行"
                      style={{ background: "none", border: "none", color: "var(--accent-green)", cursor: "pointer", padding: 2 }}>
                      <Play size={14} />
                    </button>
                  )}
                  {(entry.status === "done" || entry.status === "failed") && !entry.is_locked && (
                    <button onClick={() => retryMut.mutate(entry.article_id)} title="重试"
                      style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}>
                      <RotateCcw size={14} />
                    </button>
                  )}
                  <button onClick={() => dismissMut.mutate(entry.article_id)} title="移除"
                    style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", padding: 2 }}>
                    <X size={14} />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div style={{ background: "var(--bg-panel)", borderTop: "1px solid var(--bg-panel)", padding: "6px 16px 6px 36px" }}>
                  {/* Retry / error info */}
                  {(entry.fail_reason || entry.retry_count > 0) && (
                    <div style={{ fontSize: "var(--fs-sm)", padding: "6px 0", borderBottom: "1px solid var(--border)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {entry.retry_count > 0 && (
                        <span style={{ color: "var(--accent-gold)" }}>重试 {entry.retry_count} 次</span>
                      )}
                      {entry.last_error_type && (
                        <span style={{ color: "var(--text-muted)" }}>错误类型: {entry.last_error_type}</span>
                      )}
                      {entry.fail_reason && (
                        <span style={{ color: entry.status === "failed" ? "var(--accent-red)" : "var(--text-muted)" }}>{entry.fail_reason}</span>
                      )}
                    </div>
                  )}
                  {loadingRuns ? (
                    <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", padding: 8 }}>加载中...</div>
                  ) : articleRuns.length === 0 ? (
                    <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", padding: 8 }}>暂无运行记录</div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 70px 60px 100px 50px 30px", color: "var(--text-muted)", fontSize: "var(--fs-xs)", padding: "4px 0", borderBottom: "1px solid var(--bg-panel)" }}>
                        <span>Run ID</span><span>后端</span><span>状态</span><span>耗时</span><span>创建时间</span><span>推送</span><span></span>
                      </div>
                      {articleRuns.map((run) => {
                        const isServing = run.id === entry.serving_run_id;
                        return (
                        <div key={run.id} style={{ display: "grid", gridTemplateColumns: "60px 1fr 70px 60px 100px 50px 30px", padding: "5px 0", borderBottom: "1px solid var(--bg-panel)", alignItems: "center" }}>
                          <a onClick={() => setDetailRunId(run.id)}
                            style={{ color: "var(--accent-blue)", fontSize: "var(--fs-sm)", cursor: "pointer", textDecoration: "none" }}>
                            #{run.id}
                          </a>
                          <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-sm)" }}>{run.backend}</span>
                          <span style={{ color: runStatusColor(run.overall_status), fontSize: "var(--fs-sm)" }}>{run.overall_status}</span>
                          <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-sm)" }}>{run.elapsed_s ? `${run.elapsed_s.toFixed(1)}s` : "—"}</span>
                          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>{fmtTime(run.created_at)}</span>
                          <span>
                            {isServing ? (
                              <Star size={12} style={{ color: "var(--accent-gold)", fill: "var(--accent-gold)" }} />
                            ) : run.overall_status === "done" ? (
                              <button onClick={() => servingMut.mutate({ aid: entry.article_id, rid: run.id })} title="设为推送版本"
                                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0 }}>
                                <Star size={12} />
                              </button>
                            ) : null}
                          </span>
                          <button onClick={() => { if (confirm("删除此run?")) deleteMut.mutate(run.id); }}
                            style={{ background: "none", border: "none", color: "var(--accent-red)", cursor: "pointer", padding: 0 }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>暂无数据</div>
        )}
      </div>

      <ArticlePreviewDrawer
        articleId={previewArticleId}
        routing={previewRouting}
        onClose={() => setPreviewArticleId(null)}
      />
      <RunDetailDrawer
        runId={detailRunId}
        onClose={() => setDetailRunId(null)}
      />
    </div>
  );
}
