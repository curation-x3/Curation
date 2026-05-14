import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, RefreshCw } from "lucide-react";
import {
  fetchDedupTasks, fetchDedupTaskRuns, fetchDedupTaskServing, forceDedupTaskRun,
  fetchDedupAutoConfig, setDedupAutoConfig, fetchBackends,
} from "../lib/api";
import type { AgentBackends, DedupTaskRow, DedupTaskRun, DedupQueueRow } from "../types";
import { fmtTime, statusLabel } from "../lib/tableHelpers";
import { RunDetailDrawer } from "./RunDetailDrawer";
import { useDrawerStack } from "../state/drawerStack";
import { InlineRunTable, QueueControlBar, QueueDivider, QueueSelect, QueueSpacer, QueueSummaryBar, QueueToggle, RefreshButton, StatusChips, type StatusOption } from "./AdminQueueControls";

function TaskRunHistory({ taskId, onOpenRun }: { taskId: number; onOpenRun: (runId: number) => void }) {
  const { data: runs = [], isLoading } = useQuery<DedupTaskRun[]>({
    queryKey: ["dedupTaskRuns", taskId],
    queryFn: () => fetchDedupTaskRuns(taskId),
    staleTime: 10_000,
  });

  return <InlineRunTable rows={runs} loading={isLoading} onOpenRun={onOpenRun} />;
}

function TaskServingRows({ taskId }: { taskId: number }) {
  const { data: rows = [], isLoading } = useQuery<DedupQueueRow[]>({
    queryKey: ["dedupTaskServing", taskId],
    queryFn: () => fetchDedupTaskServing(taskId),
    staleTime: 10_000,
  });

  if (isLoading) return <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>加载中…</span>;
  if (rows.length === 0) return <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-xs)" }}>暂无队列行</span>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {rows.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
          <span style={{ color: "var(--text-primary)" }}>User {r.user_id}</span>
          <span>{r.card_date}</span>
          {statusLabel(r.status, r.error_msg, r.retry_count)}
        </div>
      ))}
    </div>
  );
}

function taskDecisionLabel(task: DedupTaskRow) {
  const run = task.latest_run;
  const d = run?.decision;
  if (!run) return { text: "未判决", color: "var(--text-faint)" };
  if (run.status === "failed") return { text: "判决失败", color: "var(--accent-red)" };
  if (run.status !== "done") return { text: "判决中", color: "var(--accent-gold)" };
  const labels: Record<string, { text: string; color: string }> = {
    unified: { text: "统一聚合", color: "var(--accent-green)" },
    mixed: { text: "部分聚合", color: "var(--accent-gold)" },
    independent: { text: "互不相似", color: "var(--text-muted)" },
  };
  return labels[d?.verdict ?? ""] ?? { text: d?.verdict ?? "已完成", color: "var(--text-muted)" };
}

function taskDecisionTitle(task: DedupTaskRow) {
  const run = task.latest_run;
  const d = run?.decision;
  if (!run) return "暂无 run 判决";
  const parts = [
    `run #${run.run_id}`,
    d?.verdict ? `verdict: ${d.verdict}` : null,
    d ? `outputs: ${d.outputs_count}` : null,
    d ? `aggregated: ${d.aggregated_count}` : null,
    d ? `passthrough: ${d.passthrough_count}` : null,
    d ? `residual: ${d.residual_count}` : null,
    d?.error_msg ? `error: ${d.error_msg}` : null,
    d?.rationale || null,
  ].filter(Boolean);
  return parts.join("\n");
}

function cardDatesLabel(dates: string[] | null | undefined) {
  const clean = Array.from(new Set((dates ?? []).filter(Boolean)));
  if (clean.length === 0) return "—";
  if (clean.length === 1) return clean[0];
  return `${clean[0]} +${clean.length - 1}`;
}

function ExpandedRow({ task, onOpenRun }: { task: DedupTaskRow; onOpenRun: (runId: number) => void }) {
  if (task.task_id == null) {
    return (
      <div style={{
        gridColumn: "1 / -1",
        background: "var(--bg-panel)",
        borderTop: "1px solid var(--bg-panel)",
        padding: "6px 16px 6px 36px",
        color: "var(--text-muted)",
        fontSize: "var(--fs-xs)",
      }}>
        Queue #{task.queue_id} 尚未被 scheduler claim 成 Task；进入运行后会显示 run 历史。
      </div>
    );
  }
  return (
    <div style={{
      gridColumn: "1 / -1",
      background: "var(--bg-panel)",
      borderTop: "1px solid var(--bg-panel)",
      padding: "6px 16px 6px 36px",
    }}>
      <div style={{ marginBottom: 10 }}>
        <TaskRunHistory taskId={task.task_id} onOpenRun={onOpenRun} />
      </div>
      <div>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", padding: "4px 0", borderBottom: "1px solid var(--bg-panel)" }}>服务中的队列行</div>
        <TaskServingRows taskId={task.task_id} />
      </div>
    </div>
  );
}

const COLS = "24px 110px 100px 90px 70px 120px 140px 105px 105px 70px";
const STATUS_OPTIONS: StatusOption[] = [
  { value: "pending", label: "待执行" },
  { value: "queued", label: "已排队", tone: "blue" },
  { value: "running", label: "运行中", tone: "gold" },
  { value: "done", label: "完成", tone: "green" },
  { value: "failed", label: "失败", tone: "red" },
];

export function DedupTasksPanel() {
  const qc = useQueryClient();
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detailRunId, setDetailRunId] = useState<number | null>(null);
  const push = useDrawerStack((s) => s.push);

  const { data: tasks = [], refetch, isFetching } = useQuery<DedupTaskRow[]>({
    queryKey: ["dedupTasks"],
    queryFn: () => fetchDedupTasks(),
    refetchInterval: 1000,
    staleTime: 500,
  });

  const forceMut = useMutation({
    mutationFn: (taskId: number) => forceDedupTaskRun(taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dedupTasks"] });
      qc.invalidateQueries({ queryKey: ["dedupTaskRuns"] });
    },
  });

  const { data: cfg } = useQuery({
    queryKey: ["dedupAutoConfig"],
    queryFn: fetchDedupAutoConfig,
    refetchInterval: 1000,
    staleTime: 500,
  });
  const { data: backendsData } = useQuery<AgentBackends>({
    queryKey: ["dedupBackends"],
    queryFn: fetchBackends,
    staleTime: 60_000,
  });
  const cfgMut = useMutation({
    mutationFn: (patch: Partial<{ auto_launch: boolean; max_concurrency: number; dedup_backend: string }>) =>
      setDedupAutoConfig(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dedupAutoConfig"] }),
  });

  const rowKey = (task: DedupTaskRow) => String(task.task_id ?? `q${task.queue_id ?? task.signature}`);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredTasks = tasks.filter((t) => statusFilters.size === 0 || statusFilters.has(t.status));
  const totalPending = filteredTasks.filter((t) => t.status === "pending").length;
  const totalQueued  = filteredTasks.filter((t) => t.status === "queued").length;
  const totalRunning = filteredTasks.filter((t) => t.status === "running").length;
  const totalDone    = filteredTasks.filter((t) => t.status === "done").length;
  const totalFailed  = filteredTasks.filter((t) => t.status === "failed").length;
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

      {/* Scheduler control bar (mirrors ArticleQueuePanel; controls execution
          of queued rows). Tab1 controls cluster generation; this controls
          how queued rows turn into Runs. */}
      <QueueSummaryBar>
        <span>共 {filteredTasks.length}</span>
        <QueueDivider />
        {totalPending > 0 && <span>待执行 <b style={{ color: "var(--text-primary)" }}>{totalPending}</b></span>}
        {totalQueued  > 0 && <span style={{ color: "var(--accent-blue)" }}>已排队 <b>{totalQueued}</b></span>}
        {totalRunning > 0 && <span style={{ color: "var(--accent-gold)" }}>运行中 <b>{totalRunning}</b></span>}
        {totalDone    > 0 && <span style={{ color: "var(--accent-green)" }}>完成 <b>{totalDone}</b></span>}
        {totalFailed  > 0 && <span style={{ color: "var(--accent-red)" }}>失败 <b>{totalFailed}</b></span>}
        <QueueSpacer />
        <QueueToggle
          label="调度"
          checked={!!cfg?.auto_launch}
          disabled={cfgMut.isPending}
          onChange={(checked) => cfgMut.mutate({ auto_launch: checked })}
          title="开 = scheduler 拉 queued 行 spawn run；关 = 全停（队列里只标记不执行）"
        />
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}
          title={`并发上限（硬顶 ${cfg?.max_concurrency_hard_cap ?? 2}）`}>
          <span>并发</span>
          <QueueSelect
            value={cfg?.max_concurrency ?? 1}
            disabled={cfgMut.isPending || !cfg}
            onChange={(value) => cfgMut.mutate({ max_concurrency: Number(value) })}>
            {Array.from({ length: cfg?.max_concurrency_hard_cap ?? 2 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </QueueSelect>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}
          title="聚合队列专用后端；不影响文章队列">
          <span>后端</span>
          <QueueSelect
            value={cfg?.dedup_backend ?? ""}
            disabled={cfgMut.isPending || !cfg}
            maxWidth={280}
            onChange={(value) => cfgMut.mutate({ dedup_backend: value })}>
            {cfg?.dedup_backend && !backendList.includes(cfg.dedup_backend) && (
              <option value={cfg.dedup_backend}>{cfg.dedup_backend}</option>
            )}
            {backendList.map((b) => <option key={b} value={b}>{b}</option>)}
          </QueueSelect>
        </label>
      </QueueSummaryBar>

      {/* Controls bar */}
      <QueueControlBar>
        <StatusChips options={STATUS_OPTIONS} selected={statusFilters} onToggle={toggleStatus} onClear={() => setStatusFilters(new Set())} />
        <QueueSpacer />
        <RefreshButton loading={isFetching} onClick={() => refetch()} />
      </QueueControlBar>

      {/* Table */}
      <div style={{ flex: 1, overflow: "auto" }}>

        {/* Header */}
        <div style={{
          display: "grid", gridTemplateColumns: COLS,
          padding: "6px 16px", borderBottom: "1px solid var(--bg-panel)",
          background: "var(--bg-panel)", color: "var(--text-muted)",
          fontSize: "var(--fs-xs)", fontWeight: 500,
          position: "sticky", top: 0, zIndex: 1, alignItems: "center", gap: 4,
        }}>
          <span />
          <span>Signature</span>
          <span style={{ textAlign: "center" }}>判决</span>
          <span style={{ textAlign: "center" }}>状态</span>
          <span style={{ textAlign: "center" }}>Served</span>
          <span>卡片日期</span>
          <span>最近运行</span>
          <span>创建日期</span>
          <span>最后更新</span>
          <span style={{ textAlign: "center" }}>操作</span>
        </div>

        {/* Rows */}
        {filteredTasks.map((task) => {
          const key = rowKey(task);
          const isOpen = expanded.has(key);
          const latestRun = task.latest_run;

          return (
            <div key={key}>
              {/* Main row */}
              <div style={{
                display: "grid", gridTemplateColumns: COLS,
                padding: "7px 16px", borderBottom: isOpen ? "none" : "1px solid var(--bg-panel)",
                alignItems: "center", gap: 4,
                background: isOpen ? "color-mix(in srgb, var(--bg-panel) 40%, transparent)" : undefined,
              }}>
                {/* Expand chevron */}
                <span
                  onClick={() => toggleExpand(key)}
                  style={{ cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center" }}>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>

                {/* Signature */}
                <button
                  onClick={() => push({ kind: "clusterSources", clusterSignature: task.signature, subtitle: `${task.signature} · signature` })}
                  title="查看 signature 原卡片"
                  style={{
                    background: "none", border: "none", padding: 0, margin: 0,
                    fontFamily: "monospace", fontSize: "var(--fs-xs)", color: "var(--accent-blue)",
                    letterSpacing: "0.02em", cursor: "pointer", textAlign: "left",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {task.signature.slice(0, 8)}
                </button>

                {/* Decision */}
                {(() => {
                  const label = taskDecisionLabel(task);
                  return (
                    <span title={taskDecisionTitle(task)} style={{ color: label.color, fontSize: "var(--fs-sm)", textAlign: "center", cursor: "help" }}>
                      {label.text}
                    </span>
                  );
                })()}

                {/* Status */}
                <span style={{ textAlign: "center" }}>
                  {statusLabel(task.status)}
                </span>

                {/* Served count */}
                <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-sm)", textAlign: "center" }}>
                  {task.served_count}
                </span>

                {/* Card dates */}
                <span
                  title={(task.card_dates ?? []).join("\n")}
                  style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {cardDatesLabel(task.card_dates)}
                </span>

                {/* Latest run */}
                <span style={{ fontSize: "var(--fs-xs)", color: latestRun ? "var(--text-muted)" : "var(--text-faint)" }}>
                  {latestRun
                    ? `#${latestRun.run_id} (${latestRun.status})`
                    : "—"}
                </span>

                {/* Created */}
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>
                  {fmtTime(task.created_at)}
                </span>

                {/* Updated */}
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>
                  {fmtTime(task.updated_at)}
                </span>

                {/* Actions */}
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <button
                    onClick={() => task.task_id != null && forceMut.mutate(task.task_id)}
                    disabled={forceMut.isPending || task.task_id == null}
                    title={task.task_id == null ? "尚未生成 Task" : "强制重跑"}
                    style={{
                      background: "none", border: "none",
                      color: task.task_id == null ? "var(--text-faint)" : "var(--accent-gold)",
                      cursor: task.task_id == null ? "default" : "pointer", padding: 2,
                      display: "flex", alignItems: "center", gap: 3,
                      fontSize: "var(--fs-xs)",
                    }}>
                    <RefreshCw size={12} />
                  </button>
                </div>
              </div>

              {/* Expanded detail */}
              {isOpen && <ExpandedRow task={task} onOpenRun={setDetailRunId} />}
            </div>
          );
        })}

        {filteredTasks.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>暂无数据</div>
        )}
      </div>
      <RunDetailDrawer
        runId={detailRunId}
        onClose={() => setDetailRunId(null)}
      />
    </div>
  );
}
