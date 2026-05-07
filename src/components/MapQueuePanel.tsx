import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Play, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
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
import { cmp, fmtTime, runStatusColor, SortableHeader, statusLabel } from "../lib/tableHelpers";
import { RunDetailDrawer } from "./RunDetailDrawer";

interface AdminUser {
  id: number;
  email: string;
  username: string;
  is_active: boolean;
}

type SortKey = "user_id" | "card_date" | "status" | "card_count" | "l1_count" | "queued_at" | "started_at";
const COLS = "34px minmax(160px,1fr) 105px 90px 80px 80px 110px 105px 92px";

function RowRuns({ rowId, onOpenRun }: { rowId: number; onOpenRun: (runId: number) => void }) {
  const { data: runs = [], isLoading } = useQuery<Run[]>({
    queryKey: ["mapQueueRuns", rowId],
    queryFn: () => fetchMapQueueRuns(rowId),
    staleTime: 10_000,
  });

  if (isLoading) return <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", padding: 8 }}>加载中...</div>;
  if (runs.length === 0) return <div style={{ color: "var(--text-faint)", fontSize: "var(--fs-sm)", padding: 8 }}>暂无运行记录</div>;

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 80px 110px 110px", color: "var(--text-muted)", fontSize: "var(--fs-xs)", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
        <span>Run ID</span><span>后端</span><span>状态</span><span>开始时间</span><span>完成时间</span>
      </div>
      {runs.map((run) => (
        <div key={run.run_id} style={{ display: "grid", gridTemplateColumns: "70px 1fr 80px 110px 110px", padding: "5px 0", borderBottom: "1px solid var(--bg-panel)", alignItems: "center" }}>
          <a onClick={() => onOpenRun(run.run_id)} style={{ color: "var(--accent-blue)", fontSize: "var(--fs-sm)", cursor: "pointer", textDecoration: "none" }}>
            #{run.run_id}
          </a>
          <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.backend ?? "—"}</span>
          <span style={{ color: runStatusColor(run.status), fontSize: "var(--fs-sm)" }}>{run.status}</span>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>{fmtTime(run.started_at)}</span>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>{fmtTime(run.completed_at)}</span>
        </div>
      ))}
    </>
  );
}

export function MapQueuePanel() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailRunId, setDetailRunId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("queued_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const params = {
    status: statusFilter,
    date: dateFilter || undefined,
    user_id: userFilter ? Number(userFilter) : undefined,
  };

  const { data: rows = [], refetch, isFetching } = useQuery<MapQueueRow[]>({
    queryKey: ["mapQueue", params.status, params.date, params.user_id],
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
  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => cmp((a as any)[sortKey], (b as any)[sortKey]) * dir);
  }, [rows, sortDir, sortKey]);
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

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const selectedIds = Array.from(selected).filter((id) => rows.some((r) => r.id === id));
  const activeUsers = users.filter((u) => u.is_active);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 16px", borderBottom: "1px solid var(--bg-panel)", background: "var(--bg-base)", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
        <span>共 {rows.length}</span>
        <span style={{ color: "var(--border)" }}>|</span>
        {(counts.pending ?? 0) > 0 && <span>待处理 <b style={{ color: "var(--text-primary)" }}>{counts.pending}</b></span>}
        {(counts.running ?? 0) > 0 && <span style={{ color: "var(--accent-gold)" }}>运行中 <b>{counts.running}</b></span>}
        {(counts.done ?? 0) > 0 && <span style={{ color: "var(--accent-green)" }}>完成 <b>{counts.done}</b></span>}
        {(counts.failed ?? 0) > 0 && <span style={{ color: "var(--accent-red)" }}>失败 <b>{counts.failed}</b></span>}
        <div style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }} title={cfg?.schedule ?? "daily yesterday CST"}>
          <input type="checkbox" checked={!!cfg?.enabled} disabled={cfgMut.isPending || !cfg} onChange={(e) => cfgMut.mutate({ enabled: e.target.checked })} />
          <span>每日自动入队 {cfg?.enabled ? <b style={{ color: "var(--accent-green)" }}>开</b> : <b style={{ color: "var(--text-muted)" }}>关</b>}</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }} title="默认保持关闭；打开后 scheduler 才会执行 pending 今日舆图任务">
          <input type="checkbox" checked={!!cfg?.auto_launch} disabled={cfgMut.isPending || !cfg} onChange={(e) => cfgMut.mutate({ auto_launch: e.target.checked })} />
          <span>调度 {cfg?.auto_launch ? <b style={{ color: "var(--accent-green)" }}>开</b> : <b style={{ color: "var(--accent-red)" }}>停</b>}</span>
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", borderBottom: "1px solid var(--bg-panel)", background: "var(--bg-panel)", flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
        <span style={{ color: "var(--text-muted)" }}>并发</span>
        <select value={cfg?.max_concurrency ?? 1} disabled={!cfg || cfgMut.isPending} onChange={(e) => cfgMut.mutate({ max_concurrency: Number(e.target.value) })}
          style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 4px", fontSize: "var(--fs-sm)" }}>
          {Array.from({ length: cfg?.max_concurrency_hard_cap ?? 3 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        <span style={{ color: "var(--text-muted)" }}>后端</span>
        <select value={cfg?.map_backend ?? ""} disabled={!cfg || cfgMut.isPending} onChange={(e) => cfgMut.mutate({ map_backend: e.target.value })}
          style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 4px", fontSize: "var(--fs-sm)", maxWidth: 280 }}>
          {cfg?.map_backend && !backendList.includes(cfg.map_backend) && <option value={cfg.map_backend}>{cfg.map_backend}</option>}
          {backendList.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", fontSize: "var(--fs-xs)" }}>
          <option value="all">全部状态</option>
          <option value="pending">待处理</option>
          <option value="running">运行中</option>
          <option value="done">完成</option>
          <option value="failed">失败</option>
        </select>
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}
          style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", fontSize: "var(--fs-xs)" }}>
          <option value="">全部用户</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username || u.email || `user #${u.id}`}</option>)}
        </select>
        <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
          style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px", fontSize: "var(--fs-xs)" }} />

        <div style={{ flex: 1 }} />
        <button disabled={!dateFilter || activeUsers.length === 0 || enqueueMut.isPending} onClick={() => enqueueMut.mutate({ userIds: activeUsers.map((u) => u.id), dates: [dateFilter] })}
          style={{ background: "var(--bg-base)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 4, padding: "2px 10px", cursor: dateFilter ? "pointer" : "default", fontSize: "var(--fs-xs)" }}>
          + 全用户入队
        </button>
        <button disabled={selectedIds.length === 0 || dispatchMut.isPending} onClick={() => dispatchMut.mutate(selectedIds)}
          style={{ background: "var(--bg-base)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 4, padding: "2px 10px", cursor: selectedIds.length ? "pointer" : "default", fontSize: "var(--fs-xs)" }}>
          触发选中 {selectedIds.length || ""}
        </button>
        <button onClick={() => refetch()} title="刷新" disabled={isFetching}
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 4, padding: "2px 6px", cursor: isFetching ? "default" : "pointer", display: "flex", alignItems: "center" }}>
          <RefreshCw size={12} style={isFetching ? { animation: "spin 1s linear infinite" } : undefined} />
        </button>
      </div>

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
    </div>
  );
}
