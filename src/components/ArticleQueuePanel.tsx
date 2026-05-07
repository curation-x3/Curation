import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Play, RotateCcw, Trash2, Star, Lock, X } from "lucide-react";
import {
  fetchQueue, fetchStrategy, patchStrategy, fetchBackends,
  triggerQueueRun, retryQueueEntry, fetchArticleRuns, deleteRun, setServingRun,
  dismissQueueEntry,
} from "../lib/api";
import { ArticlePreviewDrawer } from "./ArticlePreviewDrawer";
import { RunDetailDrawer } from "./RunDetailDrawer";
import type { QueueEntry, Run, AgentBackends } from "../types";
import {
  fmtTime, cmp, statusLabel, routingPill, SortableHeader,
} from "../lib/tableHelpers";
import { DateFilter, InlineRunTable, QueueControlBar, QueueDivider, QueueSelect, QueueSpacer, QueueSummaryBar, QueueToggle, RefreshButton, StatusChips, type InlineRunRow, type StatusOption } from "./AdminQueueControls";

type SortKey = "article_title" | "article_account" | "article_publish_time" | "status" | "routing" | "queued_at" | "started_at";
const STATUS_OPTIONS: StatusOption[] = [
  { value: "pending", label: "待处理" },
  { value: "retrying", label: "待重试", tone: "gold" },
  { value: "running", label: "运行中", tone: "gold" },
  { value: "done", label: "完成", tone: "green" },
  { value: "failed", label: "失败", tone: "red" },
  { value: "locked", label: "锁定" },
];

export function ArticleQueuePanel() {
  const qc = useQueryClient();

  const { data: queue = [], refetch: refetchQueue, isFetching: queueFetching } = useQuery<QueueEntry[]>({ queryKey: ["articleQueue"], queryFn: () => fetchQueue({ all: true }), refetchInterval: 1000, staleTime: 500 });
  const { data: strategy } = useQuery({ queryKey: ["analysisStrategy"], queryFn: fetchStrategy, refetchInterval: 1000, staleTime: 500 });
  const { data: backendsData } = useQuery<AgentBackends>({ queryKey: ["analysisBackends"], queryFn: fetchBackends, staleTime: 60_000 });

  const invalidateRuns = (aid: string | null) => {
    qc.invalidateQueries({ queryKey: ["articleQueue"] });
    if (aid) qc.invalidateQueries({ queryKey: ["articleRuns", aid] });
  };

  const [statusFilters, setStatusFilters]   = useState<Set<string>>(new Set());
  const [routingFilter, setRoutingFilter]   = useState<string>("all");
  const [dateFilter, setDateFilter]         = useState<string>("");
  const [sortKey, setSortKey]               = useState<SortKey>("queued_at");
  const [sortDir, setSortDir]               = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId]         = useState<string | null>(null);

  const [previewArticleId, setPreviewArticleId] = useState<string | null>(null);
  const [previewRouting, setPreviewRouting]      = useState<string | null>(null);
  const [detailRunId, setDetailRunId]            = useState<number | null>(null);

  const { data: articleRuns = [], isLoading: loadingRuns } = useQuery<Run[]>({
    queryKey: ["articleRuns", expandedId],
    queryFn: () => fetchArticleRuns(expandedId!),
    enabled: !!expandedId,
    refetchInterval: 3000,
    staleTime: 1000,
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
    if (statusFilters.size > 0) {
      const logicalStatus = e.status === "pending" && e.retry_count > 0 ? "retrying" : e.status;
      if (!statusFilters.has(logicalStatus)) return false;
    }
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
  const toggleStatus = (status: string) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* System status bar */}
      {strategy && (
        <QueueSummaryBar>
          {(() => {
            const retrying = queue.filter(e => e.status === "pending" && e.retry_count > 0).length;
            const pending = queue.filter(e => e.status === "pending" && e.retry_count === 0).length;
            const running = queue.filter(e => e.status === "running").length;
            const done = queue.filter(e => e.status === "done").length;
            const failed = queue.filter(e => e.status === "failed").length;
            const locked = queue.filter(e => e.status === "locked").length;
            return (
              <>
                <span>共 {queue.length}</span>
                <QueueDivider />
                {pending > 0 && <span>待处理 <b style={{ color: "var(--text-primary)" }}>{pending}</b></span>}
                {retrying > 0 && <span style={{ color: "var(--accent-gold)" }}>待重试 <b>{retrying}</b></span>}
                {running > 0 && <span style={{ color: "var(--accent-gold)" }}>运行中 <b>{running}</b></span>}
                {done > 0 && <span style={{ color: "var(--accent-green)" }}>完成 <b>{done}</b></span>}
                {failed > 0 && <span style={{ color: "var(--accent-red)" }}>失败 <b>{failed}</b></span>}
                {locked > 0 && <span>锁定 <b>{locked}</b></span>}
                <QueueSpacer />
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
        </QueueSummaryBar>
      )}

      {/* Controls bar */}
      {strategy && (
        <QueueControlBar>
          <QueueToggle
            label="调度"
            checked={!!strategy.auto_launch}
            onChange={(checked) => patchStrat("auto_launch", checked)}
            title="开 = scheduler 自动执行 pending 文章队列"
          />

          <QueueDivider />
          <span style={{ color: "var(--text-muted)" }}>并发</span>
          <QueueSelect value={strategy.max_concurrency} onChange={(value) => patchStrat("max_concurrency", Number(value))}>
            {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
          </QueueSelect>

          <QueueDivider />
          <span style={{ color: "var(--text-muted)" }}>后端</span>
          <QueueSelect value={strategy.default_backend} onChange={(value) => patchStrat("default_backend", value)} maxWidth={280}>
            {backendList.map((b) => <option key={b} value={b}>{b}</option>)}
          </QueueSelect>

          <QueueDivider />
          <StatusChips options={STATUS_OPTIONS} selected={statusFilters} onToggle={toggleStatus} onClear={() => setStatusFilters(new Set())} />

          <QueueSelect value={routingFilter} onChange={setRoutingFilter}>
            <option value="all">全部推送</option>
            <option value="ai_curation">AI梳理</option>
            <option value="original_content_with_pre_card">原文推送</option>
            <option value="original_content_with_post_card">原文推送</option>
            <option value="discard">丢弃</option>
            <option value="none">未推送</option>
          </QueueSelect>

          <DateFilter value={dateFilter} onChange={setDateFilter} />
          <QueueSpacer />

          <RefreshButton loading={queueFetching} onClick={() => refetchQueue()} />
        </QueueControlBar>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1fr) 110px 90px 80px 80px 90px 90px 80px", padding: "6px 16px", borderBottom: "1px solid var(--bg-panel)", background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: "var(--fs-xs)", fontWeight: 500, position: "sticky", top: 0, zIndex: 1 }}>
          {([
            ["article_title", "文章标题", false],
            ["article_account", "公众号", true],
            ["article_publish_time", "发布时间", true],
            ["status", "任务状态", true],
            ["routing", "推送状态", true],
            ["queued_at", "入队时间", true],
            ["started_at", "开始执行", true],
          ] as [SortKey, string, boolean][]).map(([k, label, center]) => (
            <SortableHeader key={k} label={label}
                            active={sortKey === k}
                            dir={sortDir}
                            onClick={() => toggleSort(k)}
                            align={center ? "center" : undefined} />
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
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>{entry.article_account ?? "—"}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", textAlign: "center" }}>{fmtTime(entry.article_publish_time)}</span>
                <span style={{ textAlign: "center" }}>{statusLabel(entry.status, entry.fail_reason, entry.retry_count, entry.last_error_type)}</span>
                <span style={{ textAlign: "center" }}>{routingPill(entry.routing)}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", textAlign: "center" }}>{fmtTime(entry.queued_at)}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", textAlign: "center" }}>{fmtTime(entry.started_at)}</span>
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
                  {/* Error info */}
                  {(entry.last_error_type || entry.fail_reason) && (
                    <div style={{ fontSize: "var(--fs-sm)", padding: "6px 0", borderBottom: "1px solid var(--border)", color: entry.status === "failed" ? "var(--accent-red)" : "var(--accent-gold)" }}>
                      {entry.last_error_type && <b>{entry.last_error_type}</b>}
                      {entry.retry_count > 0 && <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>已重试 {entry.retry_count} 次</span>}
                    </div>
                  )}
                  {loadingRuns ? (
                    <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", padding: 8 }}>加载中...</div>
                  ) : articleRuns.length === 0 ? (
                    <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", padding: 8 }}>暂无运行记录</div>
                  ) : (
                    <InlineRunTable
                      rows={articleRuns}
                      onOpenRun={setDetailRunId}
                      extraHeader="操作"
                      renderExtra={(run: InlineRunRow) => {
                        const isServing = run.run_id === entry.serving_run_id;
                        return (
                          <>
                            {isServing ? (
                              <Star size={12} style={{ color: "var(--accent-gold)", fill: "var(--accent-gold)" }} />
                            ) : run.status === "done" ? (
                              <button onClick={() => servingMut.mutate({ aid: entry.article_id, rid: run.run_id })} title="设为推送版本"
                                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0 }}>
                                <Star size={12} />
                              </button>
                            ) : null}
                            <button onClick={() => { if (confirm("删除此run?")) deleteMut.mutate(run.run_id); }}
                              style={{ background: "none", border: "none", color: "var(--accent-red)", cursor: "pointer", padding: 0 }}>
                              <Trash2 size={12} />
                            </button>
                          </>
                        );
                      }}
                    />
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
