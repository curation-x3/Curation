import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { fetchRun, fetchRunStream, fetchRunFiles, fetchRunFile } from "../lib/api";
import type { RunEntry, RunStreamLine } from "../types";

function statusBadge(s: string) {
  const colors: Record<string, string> = { done: "#3fb950", failed: "#f85149", running: "#d29922", pending: "#8b949e" };
  return <span style={{ color: colors[s] ?? "#8b949e", fontSize: "var(--fs-sm)" }}>{s}</span>;
}

function logLevelColor(type: string) {
  if (type.includes("stage_start") || type === "STAGE") return "#d29922";
  if (type.includes("done") || type === "DONE") return "#3fb950";
  if (type.includes("fail") || type === "ERROR" || type === "failed") return "#f85149";
  return "#58a6ff";
}

function OverviewTab({ run }: { run: RunEntry }) {
  const { data: manifestContent } = useQuery({
    queryKey: ["runManifest", run.id],
    queryFn: () => fetchRunFile(run.id, "manifest.json").catch(() => null),
    enabled: !!run.workspace_path,
  });

  let manifest: { routing?: string; routing_reason?: string; cards?: { file: string; title: string; description?: string }[] } | null = null;
  if (manifestContent) {
    try { manifest = JSON.parse(manifestContent); } catch { /* ignore */ }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ background: "#161b22", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: "var(--fs-sm)" }}>
          <div><span style={{ color: "#8b949e" }}>后端：</span><span style={{ color: "#e6edf3" }}>{run.backend}</span></div>
          <div><span style={{ color: "#8b949e" }}>状态：</span>{statusBadge(run.overall_status)}</div>
          <div><span style={{ color: "#8b949e" }}>耗时：</span><span style={{ color: "#e6edf3" }}>{run.elapsed_s ? `${run.elapsed_s.toFixed(1)}s` : "—"}</span></div>
          <div><span style={{ color: "#8b949e" }}>创建：</span><span style={{ color: "#e6edf3" }}>{run.created_at?.replace("T", " ").slice(0, 19)}</span></div>
          <div><span style={{ color: "#8b949e" }}>路由：</span><span style={{ color: "#e6edf3" }}>{run.routing ?? "—"}</span></div>
          {run.routing_reason && <div style={{ gridColumn: "1/3" }}><span style={{ color: "#8b949e" }}>路由原因：</span><span style={{ color: "#f0883e" }}>{run.routing_reason}</span></div>}
          {run.error_msg && <div style={{ gridColumn: "1/3" }}><span style={{ color: "#8b949e" }}>错误：</span><span style={{ color: "#f85149" }}>{run.error_msg}</span></div>}
        </div>
      </div>

      {manifestContent && (
        <>
          <h4 style={{ color: "#8b949e", fontSize: "var(--fs-sm)", margin: "0 0 8px" }}>Manifest</h4>
          <pre style={{ background: "#161b22", borderRadius: 8, padding: 12, marginBottom: 16, fontFamily: "monospace", fontSize: "var(--fs-xs)", color: "#c9d1d9", overflow: "auto", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(manifest, null, 2)}
          </pre>
        </>
      )}

      {manifest?.cards && manifest.cards.length > 0 && (
        <>
          <h4 style={{ color: "#8b949e", fontSize: "var(--fs-sm)", margin: "0 0 8px" }}>产出卡片</h4>
          {manifest.cards.map((c, i) => (
            <div key={i} style={{ background: "#161b22", borderRadius: 8, padding: "8px 12px", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#58a6ff", fontSize: "var(--fs-sm)" }}>{c.file}</span>
              <span style={{ color: "#8b949e", fontSize: "var(--fs-xs)" }}>{c.title}</span>
            </div>
          ))}
        </>
      )}

      {run.workspace_path && (
        <>
          <h4 style={{ color: "#8b949e", fontSize: "var(--fs-sm)", margin: "16px 0 8px" }}>Workspace</h4>
          <div style={{ background: "#161b22", borderRadius: 8, padding: "8px 12px", fontFamily: "monospace", fontSize: "var(--fs-xs)", color: "#8b949e", wordBreak: "break-all" }}>
            {run.workspace_path}
          </div>
        </>
      )}
    </div>
  );
}

function StreamLogTab({ runId }: { runId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["runStream", runId],
    queryFn: () => fetchRunStream(runId, 0, 1000),
    enabled: !!runId,
  });

  if (isLoading) return <div style={{ padding: 20, color: "#8b949e" }}>加载中...</div>;

  const lines: RunStreamLine[] = data?.data ?? [];
  if (lines.length === 0) return <div style={{ padding: 20, color: "#8b949e" }}>暂无日志</div>;

  return (
    <div style={{ padding: 16, fontFamily: "monospace", fontSize: "var(--fs-xs)", lineHeight: 1.8 }}>
      {lines.map((line, i) => {
        const ts = line.elapsed_s != null ? `[${line.elapsed_s.toFixed(1)}s]` : "";
        const typeStr = line.type ?? "";
        const stage = line.stage ?? "";
        const err = line.error ?? "";
        const display = stage ? `${typeStr} ${stage}` : err ? `${typeStr} ${err}` : typeStr;
        return (
          <div key={i} style={{ color: "#8b949e" }}>
            <span style={{ color: "#484f58" }}>{ts}</span>{" "}
            <span style={{ color: logLevelColor(typeStr) }}>{display}</span>
          </div>
        );
      })}
    </div>
  );
}

function FileListTab({ runId }: { runId: number }) {
  const { data: files, isLoading } = useQuery<string[]>({
    queryKey: ["runFiles", runId],
    queryFn: () => fetchRunFiles(runId),
    enabled: !!runId,
  });
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const { data: fileContent } = useQuery({
    queryKey: ["runFileContent", runId, viewingFile],
    queryFn: () => fetchRunFile(runId, viewingFile!),
    enabled: !!viewingFile,
  });

  if (isLoading) return <div style={{ padding: 20, color: "#8b949e" }}>加载中...</div>;
  if (!files || files.length === 0) return <div style={{ padding: 20, color: "#8b949e" }}>暂无文件</div>;

  return (
    <div style={{ padding: 16 }}>
      {files.map((f) => (
        <div key={f}
          onClick={() => setViewingFile(f === viewingFile ? null : f)}
          style={{ background: "#161b22", borderRadius: 6, padding: "6px 12px", marginBottom: 4, cursor: "pointer" }}>
          <span style={{ color: "#58a6ff", fontSize: "var(--fs-sm)" }}>{f}</span>
        </div>
      ))}
      {viewingFile && fileContent && (
        <pre style={{ background: "#161b22", borderRadius: 8, padding: 12, marginTop: 12, fontFamily: "monospace", fontSize: "var(--fs-xs)", color: "#c9d1d9", overflow: "auto", whiteSpace: "pre-wrap", maxHeight: 400 }}>
          {fileContent}
        </pre>
      )}
    </div>
  );
}

interface RunDetailDrawerProps {
  runId: number | null;
  onClose: () => void;
}

export function RunDetailDrawer({ runId, onClose }: RunDetailDrawerProps) {
  const [tab, setTab] = useState<"overview" | "stream" | "files">("overview");

  const { data: run } = useQuery<RunEntry>({
    queryKey: ["runDetail", runId],
    queryFn: () => fetchRun(runId!),
    enabled: !!runId,
  });

  if (!runId) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "65%",
        background: "#0d1117", borderLeft: "1px solid #30363d", zIndex: 101,
        display: "flex", flexDirection: "column",
        animation: "slideInRight 0.2s ease-out",
      }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#e6edf3", fontWeight: 500, fontSize: "var(--fs-base)" }}>Run #{runId}</span>
            {run && statusBadge(run.overall_status)}
            {run && <span style={{ color: "#8b949e", fontSize: "var(--fs-sm)" }}>{run.backend}</span>}
            {run?.elapsed_s && <span style={{ color: "#8b949e", fontSize: "var(--fs-sm)" }}>{run.elapsed_s.toFixed(1)}s</span>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", borderBottom: "1px solid #21262d", padding: "0 16px" }}>
          {(["overview", "stream", "files"] as const).map((t) => {
            const labels = { overview: "概览", stream: "Stream日志", files: "文件列表" };
            return (
              <button key={t} onClick={() => setTab(t)}
                style={{ background: "none", border: "none", color: tab === t ? "#e6edf3" : "#8b949e", padding: "8px 12px", cursor: "pointer", fontSize: "var(--fs-sm)", borderBottom: tab === t ? "2px solid #58a6ff" : "2px solid transparent" }}>
                {labels[t]}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflow: "auto" }}>
          {run ? (
            tab === "overview" ? <OverviewTab run={run} /> :
            tab === "stream"   ? <StreamLogTab runId={runId} /> :
                                  <FileListTab runId={runId} />
          ) : (
            <div style={{ padding: 20, color: "#8b949e" }}>加载中...</div>
          )}
        </div>
      </div>
    </>
  );
}
