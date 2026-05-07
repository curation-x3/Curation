import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Play, RotateCcw, Trash2, X } from "lucide-react";
import {
  apiFetch,
  deleteMapQueueRow,
  dispatchMapQueue,
  enqueueMapQueue,
  fetchBackends,
  fetchMapAutoConfig,
  fetchMapQueue,
  fetchMapQueueRuns,
  retryMapQueueRow,
  setMapAutoConfig,
  type MapAutoConfig,
  type MapEnqueueResult,
  type MapQueueRow,
} from "../lib/api";
import type { AgentBackends, Run } from "../types";
import { cmp, fmtTime, SortableHeader, statusLabel } from "../lib/tableHelpers";
import { DateFilter, InlineRunTable, QueueButton, QueueControlBar, QueueDivider, QueueSelect, QueueSpacer, QueueSummaryBar, QueueToggle, RefreshButton, StatusChips, type StatusOption } from "./AdminQueueControls";
import { RunDetailDrawer } from "./RunDetailDrawer";

interface AdminUser {
  id: number;
  email: string;
  username: string;
  is_active: boolean;
}

type SortKey = "user_id" | "card_date" | "status" | "card_count" | "l1_count" | "queued_at" | "started_at";
const COLS = "34px minmax(160px,1fr) 105px 90px 80px 80px 110px 105px 92px";
const STATUS_OPTIONS: StatusOption[] = [
  { value: "pending", label: "待处理" },
  { value: "running", label: "运行中", tone: "gold" },
  { value: "done", label: "完成", tone: "green" },
  { value: "failed", label: "失败", tone: "red" },
  { value: "locked", label: "锁定" },
];

function RowRuns({ rowId, onOpenRun }: { rowId: number; onOpenRun: (runId: number) => void }) {
  const { data: runs = [], isLoading } = useQuery<Run[]>({
    queryKey: ["mapQueueRuns", rowId],
    queryFn: () => fetchMapQueueRuns(rowId),
    refetchInterval: 1000,
    staleTime: 500,
  });

  return <InlineRunTable rows={runs} loading={isLoading} onOpenRun={onOpenRun} />;
}

function dateRange(start: string, end: string): string[] {
  if (!start || !end || start > end) return [];
  const dates: string[] = [];
  let cur = start;
  while (cur <= end) {
    dates.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d));
    next.setUTCDate(next.getUTCDate() + 1);
    cur = next.toISOString().slice(0, 10);
  }
  return dates;
}

function MapTriggerModal({
  users,
  onClose,
  onSubmit,
  submitting,
}: {
  users: AdminUser[];
  onClose: () => void;
  onSubmit: (input: { userIds: number[]; dates: string[] }) => Promise<MapEnqueueResult>;
  submitting: boolean;
}) {
  const activeUsers = users.filter((u) => u.is_active);
  const [selectedUsers, setSelectedUsers] = useState<Set<number>>(new Set());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MapEnqueueResult | null>(null);

  const toggleUser = (id: number) => {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedUsers((prev) => (
      activeUsers.length > 0 && prev.size === activeUsers.length
        ? new Set()
        : new Set(activeUsers.map((u) => u.id))
    ));
  };

  const submit = async () => {
    setError(null);
    if (selectedUsers.size === 0) { setError("请至少选择一个用户"); return; }
    const dates = dateRange(startDate, endDate);
    if (dates.length === 0) { setError("请选择有效的日期范围"); return; }
    try {
      const resp = await onSubmit({ userIds: Array.from(selectedUsers), dates });
      setResult(resp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
    }
  };

  const userById = new Map(activeUsers.map((u) => [u.id, u]));
  const dates = dateRange(startDate, endDate);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 24, width: 420, maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 16, color: "var(--text-primary)", fontSize: "var(--fs-sm)", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 600, fontSize: "var(--fs-base)" }}>预触发舆图</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "flex" }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)", fontWeight: 500, marginBottom: 2 }}>用户</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden", maxHeight: 180, overflowY: "auto" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--border)", cursor: "pointer", background: "var(--bg-base)", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
              <input type="checkbox" checked={activeUsers.length > 0 && selectedUsers.size === activeUsers.length} onChange={toggleAll} style={{ accentColor: "var(--accent-gold)" }} />
              全选 ({activeUsers.length})
            </label>
            {activeUsers.map((u) => (
              <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--bg-panel)", cursor: "pointer", background: selectedUsers.has(u.id) ? "color-mix(in srgb, var(--accent-gold) 8%, transparent)" : undefined }}>
                <input type="checkbox" checked={selectedUsers.has(u.id)} onChange={() => toggleUser(u.id)} style={{ accentColor: "var(--accent-gold)" }} />
                <span style={{ flex: 1 }}>{u.username || u.email}</span>
                <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-xs)" }}>{u.email}</span>
              </label>
            ))}
            {activeUsers.length === 0 && (
              <div style={{ padding: "10px", color: "var(--text-faint)", fontSize: "var(--fs-xs)", textAlign: "center" }}>暂无活跃用户</div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)", fontWeight: 500 }}>日期范围</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              style={{ flex: 1, background: "var(--bg-base)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", fontSize: "var(--fs-xs)" }} />
            <span style={{ color: "var(--text-muted)" }}>—</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              style={{ flex: 1, background: "var(--bg-base)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", fontSize: "var(--fs-xs)" }} />
          </div>
          {dates.length > 0 && (
            <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>共 {dates.length} 天</span>
          )}
        </div>

        {error && <div style={{ color: "var(--accent-red)", fontSize: "var(--fs-xs)" }}>{error}</div>}

        {result && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-base)", padding: 10, display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
              已入队 {result.rows.length} 组 user × 日期。
            </div>
            <table style={{ fontSize: "var(--fs-xs)", borderCollapse: "collapse" }}>
              <thead style={{ color: "var(--text-faint)" }}>
                <tr><th style={{ textAlign: "left", padding: "2px 6px" }}>用户</th><th style={{ textAlign: "left", padding: "2px 6px" }}>日期</th><th style={{ textAlign: "right", padding: "2px 6px" }}>Queue</th></tr>
              </thead>
              <tbody>
                {result.rows.map((r) => {
                  const u = userById.get(r.user_id);
                  return (
                    <tr key={`${r.user_id}-${r.card_date}`}>
                      <td style={{ padding: "2px 6px" }}>{u?.username || u?.email || `#${r.user_id}`}</td>
                      <td style={{ padding: "2px 6px", fontFamily: "monospace" }}>{r.card_date}</td>
                      <td style={{ padding: "2px 6px", textAlign: "right", color: "var(--accent-blue)" }}>#{r.queue_id}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <QueueButton onClick={onClose}>{result ? "关闭" : "取消"}</QueueButton>
          {!result && (
            <button onClick={submit} disabled={submitting}
              style={{ background: submitting ? "var(--bg-base)" : "var(--accent-gold)", border: "none", borderRadius: 4, color: submitting ? "var(--text-muted)" : "#fff", padding: "5px 16px", cursor: submitting ? "default" : "pointer", fontSize: "var(--fs-sm)", fontWeight: 500 }}>
              {submitting ? "提交中..." : "触发"}
            </button>
          )}
          {result && (
            <QueueButton onClick={() => { setResult(null); setError(null); }}>再触发一次</QueueButton>
          )}
        </div>
      </div>
    </div>
  );
}

export function MapQueuePanel() {
  const qc = useQueryClient();
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailRunId, setDetailRunId] = useState<number | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("queued_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const params = {
    date: dateFilter || undefined,
    user_id: userFilter ? Number(userFilter) : undefined,
  };

  const { data: rows = [], refetch, isFetching } = useQuery<MapQueueRow[]>({
    queryKey: ["mapQueue", params.date, params.user_id],
    queryFn: () => fetchMapQueue(params),
    refetchInterval: 1000,
    staleTime: 500,
  });
  const { data: cfg } = useQuery<MapAutoConfig>({
    queryKey: ["mapAutoConfig"],
    queryFn: fetchMapAutoConfig,
    refetchInterval: 1000,
    staleTime: 500,
  });
  const { data: backendsData } = useQuery<AgentBackends>({
    queryKey: ["mapBackends"],
    queryFn: fetchBackends,
    staleTime: 60_000,
  });
  const { data: users = [] } = useQuery<AdminUser[]>({
    queryKey: ["adminUsersForMap"],
    queryFn: () => apiFetch("/users").then((r) => r.json()),
    staleTime: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["mapQueue"] });
    qc.invalidateQueries({ queryKey: ["mapAutoConfig"] });
  };
  const mutationError = (e: unknown) => setActionError(e instanceof Error ? e.message : "操作失败");
  const mutationStarted = () => setActionError(null);
  const mutationDone = () => {
    setActionError(null);
    invalidate();
  };

  const cfgMut = useMutation({
    mutationFn: (patch: Partial<{ enabled: boolean; auto_launch: boolean; max_concurrency: number; map_backend: string }>) =>
      setMapAutoConfig(patch),
    onMutate: mutationStarted,
    onSuccess: mutationDone,
    onError: mutationError,
  });
  const triggerMut = useMutation({
    mutationFn: ({ userIds, dates }: { userIds: number[]; dates: string[] }) => enqueueMapQueue(userIds, dates),
    onMutate: mutationStarted,
    onSuccess: mutationDone,
    onError: mutationError,
  });
  const dispatchMut = useMutation({
    mutationFn: (ids: number[]) => dispatchMapQueue(ids),
    onMutate: mutationStarted,
    onSuccess: mutationDone,
    onError: mutationError,
  });
  const rerunMut = useMutation({
    mutationFn: async (id: number) => {
      await retryMapQueueRow(id);
      return dispatchMapQueue([id]);
    },
    onMutate: mutationStarted,
    onSuccess: mutationDone,
    onError: mutationError,
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteMapQueueRow(id),
    onMutate: mutationStarted,
    onSuccess: mutationDone,
    onError: mutationError,
  });

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const filteredRows = useMemo(() => {
    if (statusFilters.size === 0) return rows;
    return rows.filter((row) => statusFilters.has(row.status));
  }, [rows, statusFilters]);
  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return filteredRows.slice().sort((a, b) => cmp((a as any)[sortKey], (b as any)[sortKey]) * dir);
  }, [filteredRows, sortDir, sortKey]);
  const backendList = backendsData ? Object.keys(backendsData.backends ?? {}) : [];

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };
  const toggleSelected = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleStatus = (status: string) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const selectedIds = Array.from(selected).filter((id) => rows.some((r) => r.id === id));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <QueueSummaryBar>
        <span>共 {rows.length}</span>
        <QueueDivider />
        {(counts.pending ?? 0) > 0 && <span>待处理 <b style={{ color: "var(--text-primary)" }}>{counts.pending}</b></span>}
        {(counts.running ?? 0) > 0 && <span style={{ color: "var(--accent-gold)" }}>运行中 <b>{counts.running}</b></span>}
        {(counts.done ?? 0) > 0 && <span style={{ color: "var(--accent-green)" }}>完成 <b>{counts.done}</b></span>}
        {(counts.failed ?? 0) > 0 && <span style={{ color: "var(--accent-red)" }}>失败 <b>{counts.failed}</b></span>}
        <QueueSpacer />
        <QueueToggle
          label="每日入队"
          checked={!!cfg?.enabled}
          disabled={cfgMut.isPending || !cfg}
          onChange={(checked) => cfgMut.mutate({ enabled: checked })}
          title={cfg?.schedule ?? "daily yesterday CST"}
        />
        <QueueToggle
          label="调度"
          checked={!!cfg?.auto_launch}
          disabled={cfgMut.isPending || !cfg}
          onChange={(checked) => cfgMut.mutate({ auto_launch: checked })}
          title="打开后 scheduler 才会执行 pending 今日舆图任务"
        />
      </QueueSummaryBar>

      <QueueControlBar>
        <span style={{ color: "var(--text-muted)" }}>并发</span>
        <QueueSelect value={cfg?.max_concurrency ?? 1} disabled={!cfg || cfgMut.isPending} onChange={(value) => cfgMut.mutate({ max_concurrency: Number(value) })}>
          {Array.from({ length: cfg?.max_concurrency_hard_cap ?? 3 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </QueueSelect>

        <QueueDivider />
        <span style={{ color: "var(--text-muted)" }}>后端</span>
        <QueueSelect value={cfg?.map_backend ?? ""} disabled={!cfg || cfgMut.isPending} maxWidth={280} onChange={(value) => cfgMut.mutate({ map_backend: value })}>
          {cfg?.map_backend && !backendList.includes(cfg.map_backend) && <option value={cfg.map_backend}>{cfg.map_backend}</option>}
          {backendList.map((b) => <option key={b} value={b}>{b}</option>)}
        </QueueSelect>

        <QueueDivider />
        <StatusChips options={STATUS_OPTIONS} selected={statusFilters} onToggle={toggleStatus} onClear={() => setStatusFilters(new Set())} />

        <QueueSelect value={userFilter} onChange={setUserFilter}>
          <option value="">全部用户</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username || u.email || `user #${u.id}`}</option>)}
        </QueueSelect>
        <DateFilter value={dateFilter} onChange={setDateFilter} />

        <QueueSpacer />
        <QueueButton disabled={triggerMut.isPending} onClick={() => setTriggerOpen(true)}>+ 预触发</QueueButton>
        <QueueButton disabled={selectedIds.length === 0 || dispatchMut.isPending} onClick={() => dispatchMut.mutate(selectedIds)}>
          触发选中 {selectedIds.length || ""}
        </QueueButton>
        <RefreshButton loading={isFetching} onClick={() => refetch()} />
      </QueueControlBar>

      {actionError && (
        <div style={{ padding: "6px 16px", borderBottom: "1px solid var(--border)", color: "var(--accent-red)", fontSize: "var(--fs-xs)", background: "var(--bg-panel)" }}>
          {actionError}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: COLS, padding: "6px 16px", borderBottom: "1px solid var(--bg-panel)", background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: "var(--fs-xs)", fontWeight: 500, position: "sticky", top: 0, zIndex: 1, alignItems: "center" }}>
          <span />
          {([
            ["user_id", "用户", false],
            ["card_date", "日期", true],
            ["status", "状态", true],
            ["card_count", "Cards", true],
            ["l1_count", "L1", true],
            ["queued_at", "入队时间", true],
            ["started_at", "开始执行", true],
          ] as [SortKey, string, boolean][]).map(([k, label, center]) => (
            <SortableHeader key={k} label={label} active={sortKey === k} dir={sortDir} onClick={() => toggleSort(k)} align={center ? "center" : undefined} />
          ))}
          <span style={{ textAlign: "center" }}>操作</span>
        </div>

        {sortedRows.map((row) => {
          const u = userById.get(row.user_id);
          const isOpen = expandedId === row.id;
          return (
            <div key={row.id} style={{ borderBottom: "1px solid var(--bg-panel)" }}>
              <div style={{ display: "grid", gridTemplateColumns: COLS, padding: "8px 16px", alignItems: "center" }}>
                <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelected(row.id)} />
                <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                  <span onClick={() => setExpandedId(isOpen ? null : row.id)} style={{ cursor: "pointer", color: "var(--text-muted)", flexShrink: 0, width: 16 }}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <button onClick={() => setExpandedId(isOpen ? null : row.id)} style={{ background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer", padding: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--fs-sm)" }}>
                    {u ? (u.username || u.email) : `user #${row.user_id}`}
                  </button>
                  <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-xs)" }}>#{row.user_id}</span>
                </div>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", textAlign: "center" }}>{row.card_date}</span>
                <span style={{ textAlign: "center" }}>{statusLabel(row.status, row.fail_reason, row.retry_count, row.last_error_type)}</span>
                <span style={{ color: "var(--accent-blue)", fontSize: "var(--fs-sm)", textAlign: "center", fontWeight: 600 }}>{row.card_count}</span>
                <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-sm)", textAlign: "center" }}>{row.l1_count || "—"}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", textAlign: "center" }}>{fmtTime(row.queued_at)}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", textAlign: "center" }}>{fmtTime(row.started_at)}</span>
                <div style={{ display: "flex", justifyContent: "center", gap: 2 }}>
                  {row.status === "pending" && (
                    <button onClick={() => dispatchMut.mutate([row.id])} title="触发运行" style={{ background: "none", border: "none", color: "var(--accent-green)", cursor: "pointer", padding: 2 }}>
                      <Play size={14} />
                    </button>
                  )}
                  {(row.status === "done" || row.status === "failed") && (
                    <button onClick={() => rerunMut.mutate(row.id)} title="重跑" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}>
                      <RotateCcw size={14} />
                    </button>
                  )}
                  <button onClick={() => deleteMut.mutate(row.id)} title="移除" style={{ background: "none", border: "none", color: "var(--accent-red)", cursor: "pointer", padding: 2 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {isOpen && (
                <div style={{ background: "var(--bg-panel)", borderTop: "1px solid var(--bg-panel)", padding: "6px 16px 6px 48px" }}>
                  {(row.last_error_type || row.fail_reason) && (
                    <div style={{ fontSize: "var(--fs-sm)", padding: "6px 0", borderBottom: "1px solid var(--border)", color: row.status === "failed" ? "var(--accent-red)" : "var(--accent-gold)" }}>
                      {row.last_error_type && <b>{row.last_error_type}</b>}
                      {row.retry_count > 0 && <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>已重试 {row.retry_count} 次</span>}
                      {row.fail_reason && <div style={{ color: "var(--text-muted)", marginTop: 4 }}>{row.fail_reason}</div>}
                    </div>
                  )}
                  <RowRuns rowId={row.id} onOpenRun={setDetailRunId} />
                </div>
              )}
            </div>
          );
        })}

        {sortedRows.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>暂无数据</div>
        )}
      </div>

      <RunDetailDrawer runId={detailRunId} onClose={() => setDetailRunId(null)} />
      {triggerOpen && (
        <MapTriggerModal
          users={users}
          onClose={() => setTriggerOpen(false)}
          onSubmit={(input) => triggerMut.mutateAsync(input)}
          submitting={triggerMut.isPending}
        />
      )}
    </div>
  );
}
