import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, RotateCcw, Trash2, ChevronRight, ChevronDown, Eye } from "lucide-react";
import {
  fetchDedupQueueGroups, deleteDedupQueueRow, dispatchDedup, retryDedupQueueRow,
  fetchDedupAutoConfig, fetchDedupQueueSummary, setDedupAutoConfig, apiFetch,
} from "../lib/api";
import type { DedupQueueGroup, DedupQueueRow, DedupQueueSummary } from "../types";
import { cmp, fmtTime, SortableHeader, statusLabel } from "../lib/tableHelpers";
import { SourceCardsDrawer } from "./SourceCardsDrawer";
import { ArticleDrawer } from "./ArticleDrawer";
import { DateFilter, QueueButton, QueueControlBar, QueueDivider, QueueSelect, QueueSpacer, QueueSummaryBar, QueueToggle, RefreshButton, StatusChips, type StatusOption } from "./AdminQueueControls";

interface AdminUser {
  id: number;
  email: string;
  username: string;
  is_active: boolean;
}

type SortKey = "user_id" | "card_date" | "cluster_count" | "status" | "created_at" | "updated_at";
const GROUP_COLS = "minmax(180px,1fr) 120px 90px 130px 100px 100px 110px";
const CLUSTER_COLS = "70px minmax(180px,1fr) 110px 90px 90px 120px 120px 96px";
const STATUS_OPTIONS: StatusOption[] = [
  { value: "pending", label: "待派发" },
  { value: "queued", label: "已排队", tone: "blue" },
  { value: "running", label: "运行中", tone: "gold" },
  { value: "done", label: "完成", tone: "green" },
  { value: "failed", label: "失败", tone: "red" },
];

function groupStatusSummary(rows: DedupQueueRow[]) {
  if (rows.length === 0) return "无候选 cluster";
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  return [
    ["failed", "失败"],
    ["running", "运行中"],
    ["queued", "已排队"],
    ["pending", "待派发"],
    ["done", "完成"],
  ]
    .filter(([s]) => counts[s] > 0)
    .map(([s, label]) => `${label} ${counts[s]}`)
    .join(" · ");
}

function decisionLabel(row: DedupQueueRow) {
  const d = row.last_decision;
  if (!d) return { text: "未判决", color: "var(--text-faint)" };
  if (d.status === "failed") return { text: "判决失败", color: "var(--accent-red)" };
  if (d.status !== "done") return { text: "判决中", color: "var(--accent-gold)" };
  const labels: Record<string, { text: string; color: string }> = {
    unified: { text: "统一聚合", color: "var(--accent-green)" },
    mixed: { text: "部分聚合", color: "var(--accent-gold)" },
    independent: { text: "互不相似", color: "var(--text-muted)" },
  };
  return labels[d.verdict ?? ""] ?? { text: d.verdict ?? "已完成", color: "var(--text-muted)" };
}

function decisionTitle(row: DedupQueueRow) {
  const d = row.last_decision;
  if (!d) return "暂无 run 判决";
  const parts = [
    `run #${d.run_id}`,
    d.verdict ? `verdict: ${d.verdict}` : null,
    `outputs: ${d.outputs_count}`,
    `aggregated: ${d.aggregated_count}`,
    `passthrough: ${d.passthrough_count}`,
    `residual: ${d.residual_count}`,
    d.error_msg ? `error: ${d.error_msg}` : null,
    d.rationale || null,
  ].filter(Boolean);
  return parts.join("\n");
}

function QueueGroupSummary({ group }: { group: DedupQueueGroup }) {
  const { data, isLoading } = useQuery<DedupQueueSummary>({
    queryKey: ["dedupQueueSummary", group.user_id, group.card_date],
    queryFn: () => fetchDedupQueueSummary(group.user_id, group.card_date),
    staleTime: 30_000,
  });
  const done = group.rows.filter((r) => r.status === "done").length;
  const withDecision = group.rows.filter((r) => r.last_decision).length;
  const clusterCardCounts = data?.cluster_card_counts ?? group.rows.map(() => 0);
  const avgCards = clusterCardCounts.length
    ? (clusterCardCounts.reduce((sum, n) => sum + n, 0) / clusterCardCounts.length).toFixed(1)
    : "0";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      padding: "5px 0 8px", color: "var(--text-muted)", fontSize: "var(--fs-xs)",
    }}>
      <span>扫描 <b style={{ color: "var(--text-primary)" }}>{isLoading ? "…" : data?.n_scanned ?? "—"}</b> 张</span>
      <span>候选 cluster <b style={{ color: "var(--accent-blue)" }}>{data?.n_clusters ?? group.rows.length}</b></span>
      <span>已判决 <b style={{ color: "var(--accent-green)" }}>{withDecision}</b></span>
      <span>完成 <b style={{ color: "var(--accent-green)" }}>{group.rows.length === 0 && data ? data.n_clusters : done}</b></span>
      <span>平均 <b style={{ color: "var(--text-primary)" }}>{avgCards}</b> 张/cluster</span>
      {data && data.n_singletons > 0 && <span>单张 {data.n_singletons}</span>}
      {data && data.n_same_article_clusters > 0 && <span>同文跳过 {data.n_same_article_clusters}</span>}
      {data && (data.n_forced_non_ai_singletons ?? 0) > 0 && (
        <span title="routing 不是 ai_curation 的卡片不参与聚合">非AI跳过 {data.n_forced_non_ai_singletons}</span>
      )}
      {data && (data.n_missing_embedding_singletons ?? data.n_forced_singletons) > 0 && (
        <span title="AI梳理卡缺少 title/card embedding，无法进入向量聚类">无向量 {data.n_missing_embedding_singletons ?? data.n_forced_singletons}</span>
      )}
    </div>
  );
}

export function DedupQueuePanel({ onOpenPreview }: { onOpenPreview: () => void }) {
  const qc = useQueryClient();

  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter]     = useState<string>("");
  const [expandedKey, setExpandedKey]   = useState<string | null>(null);
  const [sortKey, setSortKey]           = useState<SortKey>("created_at");
  const [sortDir, setSortDir]           = useState<"asc" | "desc">("desc");

  // Drawer state — owned by this panel so admins can preview without leaving.
  const [drawerSig, setDrawerSig] = useState<string | null>(null);
  const [articleId, setArticleId] = useState<string | null>(null);
  const [articleTitle, setArticleTitle] = useState<string | null>(null);
  const [articleUrl, setArticleUrl] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dedupQueue"] });

  const { data: queueGroups = [], refetch, isFetching } = useQuery<DedupQueueGroup[]>({
    queryKey: ["dedupQueue", dateFilter || undefined],
    queryFn: () => fetchDedupQueueGroups({
      date:   dateFilter || undefined,
    }),
    refetchInterval: 1000,
    staleTime: 500,
  });

  // User lookup so the group rows can display username/email instead of raw id.
  const [users, setUsers] = useState<AdminUser[]>([]);
  useEffect(() => {
    apiFetch("/users")
      .then((r) => r.json())
      .then((all: AdminUser[]) => setUsers(all))
      .catch(() => {});
  }, []);
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const dispatchMut = useMutation({
    mutationFn: (ids: number[]) => dispatchDedup(ids),
    onSuccess: () => invalidate(),
  });
  const retryMut = useMutation({
    mutationFn: (id: number) => retryDedupQueueRow(id),
    onSuccess: () => invalidate(),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteDedupQueueRow(id),
    onSuccess: () => invalidate(),
  });

  const { data: autoConfig } = useQuery({
    queryKey: ["dedupAutoConfig"],
    queryFn: fetchDedupAutoConfig,
    refetchInterval: 1000,
    staleTime: 500,
  });
  const autoToggleMut = useMutation({
    mutationFn: (patch: Partial<{ enabled: boolean; auto_user_concurrency: number; auto_launch: boolean; max_concurrency: number }>) =>
      setDedupAutoConfig(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dedupAutoConfig"] }),
  });

  const grouped = useMemo<DedupQueueGroup[]>(() => {
    const groups = queueGroups
      .filter((group) => statusFilters.size === 0 || statusFilters.has(group.status))
      .map((group) => ({
        ...group,
        rows: group.rows.slice().sort((a, b) => cmp(a.cluster_signature, b.cluster_signature)),
      }));
    const dir = sortDir === "asc" ? 1 : -1;
    return groups.sort((a, b) => {
      const av = sortKey === "cluster_count" ? a.rows.length : (a as any)[sortKey];
      const bv = sortKey === "cluster_count" ? b.rows.length : (b as any)[sortKey];
      return cmp(av, bv) * dir;
    });
  }, [queueGroups, sortDir, sortKey, statusFilters]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  // Header summaries
  const totalPending = grouped.filter((g) => g.status === "pending").length;
  const totalQueued  = grouped.filter((g) => g.status === "queued").length;
  const totalRunning = grouped.filter((g) => g.status === "running").length;
  const totalDone    = grouped.filter((g) => g.status === "done").length;
  const totalFailed  = grouped.filter((g) => g.status === "failed").length;
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

      {/* Summary bar */}
      <QueueSummaryBar>
        <span>共 {grouped.length}</span>
        <QueueDivider />
        {totalPending > 0 && <span>待派发 <b style={{ color: "var(--text-primary)" }}>{totalPending}</b></span>}
        {totalQueued  > 0 && <span style={{ color: "var(--accent-blue)" }}>已排队 <b>{totalQueued}</b></span>}
        {totalRunning > 0 && <span style={{ color: "var(--accent-gold)" }}>运行中 <b>{totalRunning}</b></span>}
        {totalDone    > 0 && <span style={{ color: "var(--accent-green)" }}>完成 <b>{totalDone}</b></span>}
        {totalFailed  > 0 && <span style={{ color: "var(--accent-red)" }}>失败 <b>{totalFailed}</b></span>}
        <QueueSpacer />
        {/* Tab1 controls only the cluster auto-preview (whether 4-5am batch
            generates clusters & enqueues them). Execution scheduler controls
            (auto_launch / max_concurrency) live on Tab2. */}
        <QueueToggle
          label="每日入队"
          checked={!!autoConfig?.enabled}
          disabled={autoToggleMut.isPending}
          onChange={(checked) => autoToggleMut.mutate({ enabled: checked })}
          title={autoConfig?.schedule ?? "daily 04:00-05:00 CST"}
        />
        {autoConfig?.last_run_date && <span style={{ color: "var(--text-faint)" }}>上次 {autoConfig.last_run_date}</span>}
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}
          title={`自动入队用户并发（硬顶 ${autoConfig?.auto_user_concurrency_hard_cap ?? 4}）`}>
          <span>用户并发</span>
          <QueueSelect
            value={autoConfig?.auto_user_concurrency ?? 1}
            disabled={autoToggleMut.isPending}
            onChange={(value) => autoToggleMut.mutate({ auto_user_concurrency: Number(value) })}>
            {Array.from({ length: autoConfig?.auto_user_concurrency_hard_cap ?? 4 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </QueueSelect>
        </label>
      </QueueSummaryBar>

      {/* Controls bar */}
      <QueueControlBar>
        <StatusChips options={STATUS_OPTIONS} selected={statusFilters} onToggle={toggleStatus} onClear={() => setStatusFilters(new Set())} />
        <DateFilter value={dateFilter} onChange={setDateFilter} />
        <QueueSpacer />
        <QueueButton onClick={onOpenPreview}>
          + 预触发
        </QueueButton>
        <RefreshButton loading={isFetching} onClick={() => refetch()} />
      </QueueControlBar>

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: GROUP_COLS, padding: "6px 16px", borderBottom: "1px solid var(--bg-panel)", background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: "var(--fs-xs)", fontWeight: 500, position: "sticky", top: 0, zIndex: 1, alignItems: "center" }}>
          {([
            ["user_id", "用户", false],
            ["card_date", "日期", true],
            ["cluster_count", "Clusters", true],
            ["status", "状态", true],
            ["created_at", "入队时间", true],
            ["updated_at", "更新时间", true],
          ] as [SortKey, string, boolean][]).map(([k, label, center]) => (
            <SortableHeader key={k} label={label}
                            active={sortKey === k}
                            dir={sortDir}
                            onClick={() => toggleSort(k)}
                            align={center ? "center" : undefined} />
          ))}
          <span style={{ textAlign: "center" }}>操作</span>
        </div>

        {grouped.map((group) => {
          const u = userById.get(group.user_id);
          const isOpen = expandedKey === group.key;
          const pendingIds = group.rows.filter((r) => r.status === "pending").map((r) => r.id);
          return (
            <div key={group.key} style={{ borderBottom: "1px solid var(--bg-panel)" }}>
              <div style={{ display: "grid", gridTemplateColumns: GROUP_COLS, padding: "8px 16px", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                  <span
                    onClick={() => setExpandedKey(isOpen ? null : group.key)}
                    style={{ cursor: "pointer", color: "var(--text-muted)", flexShrink: 0, width: 16 }}
                  >
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <button
                    onClick={() => setExpandedKey(isOpen ? null : group.key)}
                    title="查看预聚合运行结果"
                    style={{
                      background: "none", border: "none", padding: 0, margin: 0,
                      color: "var(--text-primary)", fontSize: "var(--fs-sm)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    {u ? (u.username || u.email) : `user #${group.user_id}`}
                  </button>
                  <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-xs)", flexShrink: 0 }}>#{group.user_id}</span>
                </div>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", textAlign: "center" }}>{group.card_date}</span>
                <span style={{ color: "var(--accent-blue)", fontSize: "var(--fs-sm)", textAlign: "center", fontWeight: 600 }}>{group.rows.length}</span>
                <span title={groupStatusSummary(group.rows)} style={{ textAlign: "center" }}>{statusLabel(group.status)}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", textAlign: "center" }}>{fmtTime(group.created_at)}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", textAlign: "center" }}>{fmtTime(group.updated_at)}</span>
                <div style={{ display: "flex", justifyContent: "center", gap: 2 }}>
                  {pendingIds.length > 0 && (
                    <button onClick={() => dispatchMut.mutate(pendingIds)} title={`派发 ${pendingIds.length} 个待派发 cluster`}
                      style={{ background: "none", border: "none", color: "var(--accent-green)", cursor: "pointer", padding: 2 }}>
                      <Play size={14} />
                    </button>
                  )}
                  <button onClick={() => setExpandedKey(isOpen ? null : group.key)} title={isOpen ? "收起" : "展开 clusters"}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div style={{ background: "var(--bg-panel)", borderTop: "1px solid var(--bg-panel)", padding: "6px 16px 6px 36px" }}>
                  <QueueGroupSummary group={group} />
                  {group.rows.length === 0 ? (
                    <div style={{ padding: "10px 0", color: "var(--text-faint)", fontSize: "var(--fs-sm)" }}>
                      无候选 cluster，未产生入队任务。
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: CLUSTER_COLS, color: "var(--text-muted)", fontSize: "var(--fs-xs)", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                        <span>Queue ID</span><span>Signature</span><span style={{ textAlign: "center" }}>判决</span><span style={{ textAlign: "center" }}>状态</span><span style={{ textAlign: "center" }}>Task</span><span style={{ textAlign: "center" }}>入队</span><span style={{ textAlign: "center" }}>更新</span><span style={{ textAlign: "center" }}>操作</span>
                      </div>
                      {group.rows.map((row) => (
                        <div key={row.id} style={{ display: "grid", gridTemplateColumns: CLUSTER_COLS, padding: "5px 0", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>#{row.id}</span>
                          <a onClick={() => setDrawerSig(row.cluster_signature)}
                            style={{ fontFamily: "monospace", color: "var(--accent-blue)", cursor: "pointer", textDecoration: "none", fontSize: "var(--fs-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {row.cluster_signature}
                          </a>
                          {(() => {
                            const label = decisionLabel(row);
                            return (
                              <span title={decisionTitle(row)} style={{ color: label.color, fontSize: "var(--fs-sm)", textAlign: "center", cursor: "help" }}>
                                {label.text}
                              </span>
                            );
                          })()}
                          <span style={{ textAlign: "center" }}>{statusLabel(row.status, row.error_msg, row.retry_count)}</span>
                          <span style={{ color: row.task_id != null ? "var(--accent-blue)" : "var(--text-faint)", fontSize: "var(--fs-sm)", textAlign: "center" }}>
                            {row.task_id != null ? `#${row.task_id}` : "—"}
                          </span>
                          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", textAlign: "center" }}>{fmtTime(row.created_at)}</span>
                          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", textAlign: "center" }}>{fmtTime(row.updated_at)}</span>
                          <div style={{ display: "flex", justifyContent: "center", gap: 2 }}>
                            {row.status === "pending" && (
                              <button onClick={() => dispatchMut.mutate([row.id])} title="加入调度队列"
                                style={{ background: "none", border: "none", color: "var(--accent-green)", cursor: "pointer", padding: 2 }}>
                                <Play size={14} />
                              </button>
                            )}
                            {(row.status === "done" || row.status === "failed") && (
                              <button onClick={() => retryMut.mutate(row.id)} title="重试"
                                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}>
                                <RotateCcw size={14} />
                              </button>
                            )}
                            <button onClick={() => setDrawerSig(row.cluster_signature)} title="查看原卡片"
                              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}>
                              <Eye size={14} />
                            </button>
                            <button onClick={() => { if (confirm("删除此 cluster?")) deleteMut.mutate(row.id); }} title="删除"
                              style={{ background: "none", border: "none", color: "var(--accent-red)", cursor: "pointer", padding: 2 }}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {grouped.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>暂无数据</div>
        )}
      </div>

      {/* Source-cards drawer (cluster mode) */}
      <SourceCardsDrawer
        clusterSignature={drawerSig}
        isOpen={!!drawerSig}
        onClose={() => setDrawerSig(null)}
        subtitle={drawerSig ? `${drawerSig} · 原卡片` : undefined}
        onOpenArticle={(aid, atitle, aurl) => {
          setArticleId(aid);
          setArticleTitle(atitle ?? null);
          setArticleUrl(aurl ?? null);
        }}
      />

      {/* Article drawer reused via override mode */}
      <ArticleDrawer
        isOpen={!!articleId}
        onClose={() => { setArticleId(null); setArticleTitle(null); setArticleUrl(null); }}
        item={null}
        siblingCards={[]}
        onSelectCard={() => {}}
        articleIdOverride={articleId}
        articleTitleOverride={articleTitle}
        articleUrlOverride={articleUrl}
      />
    </div>
  );
}
