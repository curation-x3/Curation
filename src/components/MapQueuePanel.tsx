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
    staleTime: 10_000,
  });

  return <InlineRunTable rows={runs} loading={isLoading} onOpenRun={onOpenRun} />;
}

function MapTriggerModal({
  users,
  backendList,
  defaultBackend,
  onClose,
  onSubmit,
  submitting,
}: {
  users: AdminUser[];
  backendList: string[];
  defaultBackend: string;
  onClose: () => void;
  onSubmit: (input: { userId: number; date: string; backend?: string }) => Promise<unknown>;
  submitting: boolean;
}) {
  const activeUsers = users.filter((u) => u.is_active);
  const [userId, setUserId] = useState<number | "">(activeUsers[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [backend, setBackend] = useState(defaultBackend);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!userId) { setError("请选择用户"); return; }
    if (!date) { setError("请选择日期"); return; }
    try {
      await onSubmit({ userId: Number(userId), date, backend: backend || undefined });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "触发失败");
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 24, width: 420, maxWidth: "90vw", display: "flex", flexDirection: "column", gap: 16, color: "var(--text-primary)", fontSize: "var(--fs-sm)", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 600, fontSize: "var(--fs-base)" }}>触发今日舆图</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "flex" }}>
            <X size={16} />
          </button>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)", fontWeight: 500 }}>用户</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : "")}
            style={{ background: "var(--bg-base)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", fontSize: "var(--fs-sm)" }}>
            {activeUsers.length === 0 && <option value="">暂无活跃用户</option>}
            {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.username || u.email || `user #${u.id}`}</option>)}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)", fontWeight: 500 }}>日期</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ background: "var(--bg-base)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", fontSize: "var(--fs-sm)" }} />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)", fontWeight: 500 }}>后端</span>
          <select value={backend} onChange={(e) => setBackend(e.target.value)}
            style={{ background: "var(--bg-base)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", fontSize: "var(--fs-sm)" }}>
            {defaultBackend && !backendList.includes(defaultBackend) && <option value={defaultBackend}>{defaultBackend}</option>}
            {backendList.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>

        {error && <div style={{ color: "var(--accent-red)", fontSize: "var(--fs-xs)" }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <QueueButton onClick={onClose}>取消</QueueButton>
          <button onClick={submit} disabled={submitting}
            style={{ background: submitting ? "var(--bg-base)" : "var(--accent-gold)", border: "none", borderRadius: 4, color: submitting ? "var(--text-muted)" : "#fff", padding: "5px 16px", cursor: submitting ? "default" : "pointer", fontSize: "var(--fs-sm)", fontWeight: 500 }}>
            {submitting ? "提交中..." : "触发"}
          </button>
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

  const cfgMut = useMutation({
    mutationFn: (patch: Partial<{ enabled: boolean; auto_launch: boolean; max_concurrency: number; map_backend: string }>) =>
      setMapAutoConfig(patch),
    onSuccess: invalidate,
  });
  const enqueueMut = useMutation({
    mutationFn: ({ userIds, dates }: { userIds: number[]; dates: string[] }) => enqueueMapQueue(userIds, dates),
    onSuccess: invalidate,
  });
  const dispatchMut = useMutation({
    mutationFn: (ids: number[]) => dispatchMapQueue(ids),
    onSuccess: invalidate,
  });
  const triggerOneMut = useMutation({
    mutationFn: async ({ userId, date, backend }: { userId: number; date: string; backend?: string }) => {
      const created = await enqueueMapQueue([userId], [date]);
      const ids = created.rows.map((row) => row.queue_id);
      if (ids.length === 0) return { results: [] };
      return dispatchMapQueue(ids, backend);
    },
    onSuccess: invalidate,
  });
  const rerunMut = useMutation({
    mutationFn: async (id: number) => {
      await retryMapQueueRow(id);
      return dispatchMapQueue([id]);
    },
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteMapQueueRow(id),
    onSuccess: invalidate,
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
  const activeUsers = users.filter((u) => u.is_active);

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
        <QueueButton disabled={triggerOneMut.isPending} onClick={() => setTriggerOpen(true)}>+ 单用户触发</QueueButton>
        <QueueButton disabled={!dateFilter || activeUsers.length === 0 || enqueueMut.isPending} onClick={() => enqueueMut.mutate({ userIds: activeUsers.map((u) => u.id), dates: [dateFilter] })}>
          + 全用户入队
        </QueueButton>
        <QueueButton disabled={selectedIds.length === 0 || dispatchMut.isPending} onClick={() => dispatchMut.mutate(selectedIds)}>
          触发选中 {selectedIds.length || ""}
        </QueueButton>
        <RefreshButton loading={isFetching} onClick={() => refetch()} />
      </QueueControlBar>

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
          backendList={backendList}
          defaultBackend={cfg?.map_backend ?? ""}
          onClose={() => setTriggerOpen(false)}
          onSubmit={(input) => triggerOneMut.mutateAsync(input)}
          submitting={triggerOneMut.isPending}
        />
      )}
    </div>
  );
}
