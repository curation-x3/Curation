import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { fmtTime, runStatusColor } from "../lib/tableHelpers";

export interface StatusOption {
  value: string;
  label: string;
  tone?: "blue" | "gold" | "green" | "red" | "muted";
}

const toneColor: Record<NonNullable<StatusOption["tone"]>, string> = {
  blue: "var(--accent-blue)",
  gold: "var(--accent-gold)",
  green: "var(--accent-green)",
  red: "var(--accent-red)",
  muted: "var(--text-muted)",
};

export function QueueSummaryBar({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 16px", borderBottom: "1px solid var(--bg-panel)", background: "var(--bg-base)", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
      {children}
    </div>
  );
}

export function QueueControlBar({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: "1px solid var(--bg-panel)", background: "var(--bg-panel)", flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
      {children}
    </div>
  );
}

export function QueueDivider() {
  return <span style={{ color: "var(--border)" }}>|</span>;
}

export function QueueSpacer() {
  return <div style={{ flex: 1 }} />;
}

export function QueueSelect({
  value,
  onChange,
  children,
  disabled,
  maxWidth,
}: {
  value: string | number;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  maxWidth?: number;
}) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", fontSize: "var(--fs-xs)", maxWidth }}>
      {children}
    </select>
  );
}

export function QueueButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ background: "var(--bg-base)", border: "1px solid var(--border)", color: disabled ? "var(--text-faint)" : "var(--text-primary)", borderRadius: 4, padding: "2px 10px", cursor: disabled ? "default" : "pointer", fontSize: "var(--fs-xs)" }}>
      {children}
    </button>
  );
}

export function RefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title="刷新" disabled={loading}
      style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 4, padding: "2px 6px", cursor: loading ? "default" : "pointer", display: "flex", alignItems: "center" }}>
      <RefreshCw size={12} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
    </button>
  );
}

export function QueueToggle({
  label,
  checked,
  disabled,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: disabled ? "default" : "pointer" }} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label} {checked ? <b style={{ color: "var(--accent-green)" }}>开</b> : <b style={{ color: "var(--accent-red)" }}>关</b>}</span>
    </label>
  );
}

export function StatusChips({
  options,
  selected,
  onToggle,
  onClear,
}: {
  options: StatusOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      <button onClick={onClear}
        style={{ background: selected.size === 0 ? "var(--accent-gold)" : "var(--bg-panel)", color: selected.size === 0 ? "#1a1208" : "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: "var(--fs-xs)" }}>
        全部状态
      </button>
      {options.map((opt) => {
        const active = selected.has(opt.value);
        const color = toneColor[opt.tone ?? "muted"];
        return (
          <button key={opt.value} onClick={() => onToggle(opt.value)}
            style={{ background: active ? "var(--bg-base)" : "transparent", color: active ? color : "var(--text-muted)", border: `1px solid ${active ? color : "var(--border)"}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: "var(--fs-xs)" }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function DateFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px", fontSize: "var(--fs-xs)" }} />
      {value && (
        <button onClick={() => onChange("")} title="清除日期"
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0 2px", fontSize: "var(--fs-xs)" }}>×</button>
      )}
    </div>
  );
}

export interface InlineRunRow {
  run_id: number;
  backend?: string | null;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  error_msg?: string | null;
}

function elapsedRun(run: InlineRunRow): string {
  if (!run.started_at || !run.completed_at) return "—";
  const elapsed = (new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000;
  return Number.isFinite(elapsed) && elapsed >= 0 ? `${elapsed.toFixed(1)}s` : "—";
}

export function InlineRunTable({
  rows,
  loading,
  onOpenRun,
  extraHeader,
  renderExtra,
}: {
  rows: InlineRunRow[];
  loading?: boolean;
  onOpenRun: (runId: number) => void;
  extraHeader?: string;
  renderExtra?: (run: InlineRunRow) => ReactNode;
}) {
  if (loading) return <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", padding: 8 }}>加载中...</div>;
  if (rows.length === 0) return <div style={{ color: "var(--text-faint)", fontSize: "var(--fs-sm)", padding: 8 }}>暂无运行记录</div>;

  const cols = extraHeader
    ? "70px minmax(180px,1fr) 80px 64px 110px 110px minmax(120px,1fr) 72px"
    : "70px minmax(180px,1fr) 80px 64px 110px 110px minmax(120px,1fr)";

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: cols, color: "var(--text-muted)", fontSize: "var(--fs-xs)", padding: "4px 0", borderBottom: "1px solid var(--border)", alignItems: "center", gap: 6 }}>
        <span>Run ID</span><span>后端</span><span>状态</span><span>耗时</span><span>开始时间</span><span>完成时间</span><span>错误</span>{extraHeader && <span style={{ textAlign: "center" }}>{extraHeader}</span>}
      </div>
      {rows.map((run) => (
        <div key={run.run_id} style={{ display: "grid", gridTemplateColumns: cols, padding: "5px 0", borderBottom: "1px solid var(--bg-panel)", alignItems: "center", gap: 6 }}>
          <a onClick={() => onOpenRun(run.run_id)} style={{ color: "var(--accent-blue)", fontSize: "var(--fs-sm)", cursor: "pointer", textDecoration: "none" }}>
            #{run.run_id}
          </a>
          <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.backend ?? "—"}</span>
          <span style={{ color: runStatusColor(run.status), fontSize: "var(--fs-sm)" }}>{run.status}</span>
          <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-sm)" }}>{elapsedRun(run)}</span>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>{fmtTime(run.started_at ?? run.created_at ?? null)}</span>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>{fmtTime(run.completed_at ?? null)}</span>
          <span title={run.error_msg ?? undefined} style={{ color: run.error_msg ? "var(--accent-red)" : "var(--text-faint)", fontSize: "var(--fs-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {run.error_msg || "—"}
          </span>
          {extraHeader && <span style={{ display: "flex", justifyContent: "center", gap: 4 }}>{renderExtra?.(run)}</span>}
        </div>
      ))}
    </>
  );
}
