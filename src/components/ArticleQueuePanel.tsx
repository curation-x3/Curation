import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Play, RotateCcw, Trash2 } from "lucide-react";
import {
  fetchQueue, fetchStrategy, patchStrategy, fetchBackends,
  triggerQueueRun, retryQueueEntry, fetchArticleRuns, deleteRun,
} from "../lib/api";
import { ArticlePreviewDrawer } from "./ArticlePreviewDrawer";
import { RunDetailDrawer } from "./RunDetailDrawer";
import type { QueueEntry, RunEntry, AgentBackends } from "../types";

function fmtTime(t: string | null) {
  if (!t) return "—";
  return t.replace("T", " ").slice(5, 16);
}

function statusLabel(s: string) {
  const m: Record<string, { text: string; color: string }> = {
    pending:  { text: "待处理", color: "#8b949e" },
    running:  { text: "运行中", color: "#d29922" },
    done:     { text: "完成",   color: "#3fb950" },
    failed:   { text: "失败",   color: "#f85149" },
  };
  const v = m[s] ?? { text: s, color: "#8b949e" };
  return <span style={{ color: v.color, fontSize: "0.78rem" }}>{v.text}</span>;
}

function routingPill(routing: string | null) {
  if (!routing) {
    return <span style={{ background: "#1c1c1c", color: "#484f58", padding: "1px 8px", borderRadius: 10, fontSize: "0.68rem" }}>未推送</span>;
  }
  const m: Record<string, { text: string; bg: string; color: string }> = {
    ai_curation:   { text: "AI梳理",  bg: "#1a3a1a", color: "#3fb950" },
    original_push: { text: "原文推送", bg: "#1a3a1a", color: "#3fb950" },
    discard:       { text: "丢弃",     bg: "#2d2a1a", color: "#d29922" },
  };
  const v = m[routing] ?? { text: routing, bg: "#1c1c1c", color: "#484f58" };
  return <span style={{ background: v.bg, color: v.color, padding: "1px 8px", borderRadius: 10, fontSize: "0.68rem" }}>{v.text}</span>;
}

function runStatusColor(s: string) {
  const m: Record<string, string> = { done: "#3fb950", failed: "#f85149", running: "#d29922", pending: "#8b949e" };
  return m[s] ?? "#8b949e";
}

export function ArticleQueuePanel() {
  const qc = useQueryClient();

  const { data: queue = [] } = useQuery<QueueEntry[]>({ queryKey: ["articleQueue"], queryFn: fetchQueue, refetchInterval: 5000 });
  const { data: strategy } = useQuery({ queryKey: ["analysisStrategy"], queryFn: fetchStrategy, refetchInterval: 5000 });
  const { data: backendsData } = useQuery<AgentBackends>({ queryKey: ["analysisBackends"], queryFn: fetchBackends, staleTime: 60_000 });

  const triggerMut = useMutation({ mutationFn: (aid: string) => triggerQueueRun(aid), onSuccess: () => qc.invalidateQueries({ queryKey: ["articleQueue"] }) });
  const retryMut   = useMutation({ mutationFn: (aid: string) => retryQueueEntry(aid), onSuccess: () => qc.invalidateQueries({ queryKey: ["articleQueue"] }) });
  const deleteMut  = useMutation({ mutationFn: (rid: number) => deleteRun(rid), onSuccess: () => { qc.invalidateQueries({ queryKey: ["articleQueue"] }); } });

  const [statusFilter, setStatusFilter]     = useState<string>("all");
  const [routingFilter, setRoutingFilter]   = useState<string>("all");
  const [expandedId, setExpandedId]         = useState<string | null>(null);
  const [articleRuns, setArticleRuns]        = useState<RunEntry[]>([]);
  const [loadingRuns, setLoadingRuns]        = useState(false);

  const [previewArticleId, setPreviewArticleId] = useState<string | null>(null);
  const [previewRouting, setPreviewRouting]      = useState<string | null>(null);
  const [detailRunId, setDetailRunId]            = useState<number | null>(null);

  useEffect(() => {
    if (!expandedId) { setArticleRuns([]); return; }
    setLoadingRuns(true);
    fetchArticleRuns(expandedId).then((runs) => { setArticleRuns(runs); setLoadingRuns(false); }).catch(() => setLoadingRuns(false));
  }, [expandedId]);

  const patchStrat = (key: string, value: unknown) => {
    patchStrategy({ [key]: value }).then(() => qc.invalidateQueries({ queryKey: ["analysisStrategy"] }));
  };

  const filtered = queue.filter((e) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (routingFilter === "all") return true;
    if (routingFilter === "none") return !e.routing;
    return e.routing === routingFilter;
  });

  const backendList = backendsData ? Object.keys(backendsData.backends ?? backendsData) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {strategy && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", borderBottom: "1px solid #21262d", background: "#161b22", flexWrap: "wrap", fontSize: "0.78rem" }}>
          <span style={{ color: "#8b949e" }}>自动启动</span>
          <button
            onClick={() => patchStrat("auto_launch", !strategy.auto_launch)}
            style={{ background: strategy.auto_launch ? "#238636" : "#30363d", color: "#fff", border: "none", borderRadius: 10, padding: "1px 10px", cursor: "pointer", fontSize: "0.72rem" }}
          >{strategy.auto_launch ? "开" : "关"}</button>

          <span style={{ color: "#30363d" }}>|</span>
          <span style={{ color: "#8b949e" }}>并发</span>
          <select value={strategy.max_concurrency} onChange={(e) => patchStrat("max_concurrency", +e.target.value)}
            style={{ background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 4, padding: "1px 4px", fontSize: "0.75rem" }}>
            {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>

          <span style={{ color: "#30363d" }}>|</span>
          <span style={{ color: "#8b949e" }}>后端</span>
          <select value={strategy.default_backend} onChange={(e) => patchStrat("default_backend", e.target.value)}
            style={{ background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 4, padding: "1px 4px", fontSize: "0.75rem" }}>
            {backendList.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>

          <div style={{ flex: 1 }} />

          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            style={{ background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 4, padding: "2px 8px", fontSize: "0.72rem" }}>
            <option value="all">全部状态</option>
            <option value="pending">待处理</option>
            <option value="running">运行中</option>
            <option value="done">完成</option>
            <option value="failed">失败</option>
          </select>

          <select value={routingFilter} onChange={(e) => setRoutingFilter(e.target.value)}
            style={{ background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 4, padding: "2px 8px", fontSize: "0.72rem" }}>
            <option value="all">全部推送</option>
            <option value="ai_curation">AI梳理</option>
            <option value="original_push">原文推送</option>
            <option value="discard">丢弃</option>
            <option value="none">未推送</option>
          </select>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,1fr) 90px 80px 80px 110px 50px", padding: "6px 16px", borderBottom: "1px solid #21262d", background: "#161b22", color: "#8b949e", fontSize: "0.7rem", fontWeight: 500, position: "sticky", top: 0, zIndex: 1 }}>
          <span>文章标题</span>
          <span>发布时间</span>
          <span>任务状态</span>
          <span>推送状态</span>
          <span>最后入队</span>
          <span style={{ textAlign: "center" }}>操作</span>
        </div>

        {filtered.map((entry) => {
          const isExpanded = expandedId === entry.article_id;
          return (
            <div key={entry.article_id} style={{ borderBottom: "1px solid #21262d" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,1fr) 90px 80px 80px 110px 50px", padding: "8px 16px", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                  <span
                    onClick={() => setExpandedId(isExpanded ? null : entry.article_id)}
                    style={{ cursor: "pointer", color: "#8b949e", flexShrink: 0, width: 16 }}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <a
                    onClick={() => { setPreviewArticleId(entry.article_id); setPreviewRouting(entry.routing); }}
                    style={{ color: "#58a6ff", cursor: "pointer", textDecoration: "none", fontSize: "0.82rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {entry.article_title}
                  </a>
                  <span style={{ color: "#484f58", fontSize: "0.68rem", flexShrink: 0 }}>{entry.run_count} runs</span>
                </div>
                <span style={{ color: "#8b949e", fontSize: "0.78rem" }}>{fmtTime(entry.article_publish_time)}</span>
                {statusLabel(entry.status)}
                {routingPill(entry.routing)}
                <span style={{ color: "#8b949e", fontSize: "0.78rem" }}>{fmtTime(entry.updated_at)}</span>
                <div style={{ textAlign: "center" }}>
                  {entry.status === "pending" && (
                    <button onClick={() => triggerMut.mutate(entry.article_id)} title="触发运行"
                      style={{ background: "none", border: "none", color: "#3fb950", cursor: "pointer", padding: 2 }}>
                      <Play size={14} />
                    </button>
                  )}
                  {(entry.status === "done" || entry.status === "failed") && (
                    <button onClick={() => retryMut.mutate(entry.article_id)} title="重试"
                      style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", padding: 2 }}>
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div style={{ background: "#161b22", borderTop: "1px solid #21262d", padding: "6px 16px 6px 36px" }}>
                  {loadingRuns ? (
                    <div style={{ color: "#8b949e", fontSize: "0.75rem", padding: 8 }}>加载中...</div>
                  ) : articleRuns.length === 0 ? (
                    <div style={{ color: "#8b949e", fontSize: "0.75rem", padding: 8 }}>暂无运行记录</div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "60px 80px 70px 60px 100px 30px", color: "#8b949e", fontSize: "0.65rem", padding: "4px 0", borderBottom: "1px solid #21262d" }}>
                        <span>Run ID</span><span>后端</span><span>状态</span><span>耗时</span><span>创建时间</span><span></span>
                      </div>
                      {articleRuns.map((run) => (
                        <div key={run.id} style={{ display: "grid", gridTemplateColumns: "60px 80px 70px 60px 100px 30px", padding: "5px 0", borderBottom: "1px solid #21262d", alignItems: "center" }}>
                          <a onClick={() => setDetailRunId(run.id)}
                            style={{ color: "#58a6ff", fontSize: "0.75rem", cursor: "pointer", textDecoration: "none" }}>
                            #{run.id}
                          </a>
                          <span style={{ color: "#e6edf3", fontSize: "0.75rem" }}>{run.backend}</span>
                          <span style={{ color: runStatusColor(run.overall_status), fontSize: "0.75rem" }}>{run.overall_status}</span>
                          <span style={{ color: "#e6edf3", fontSize: "0.75rem" }}>{run.elapsed_s ? `${run.elapsed_s.toFixed(1)}s` : "—"}</span>
                          <span style={{ color: "#8b949e", fontSize: "0.7rem" }}>{fmtTime(run.created_at)}</span>
                          <button onClick={() => { if (confirm("删除此run?")) deleteMut.mutate(run.id); }}
                            style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", padding: 0 }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "#484f58" }}>暂无数据</div>
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
