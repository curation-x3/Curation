import { useEffect, useState } from "react";
import { Play, RefreshCw, ChevronDown, ChevronRight, Eye, Columns2, List, Radio } from "lucide-react";
import { RunProgress } from "./RunProgress";
import { FileViewer } from "./FileViewer";
import type { Article, AnalysisRun, AgentVersion, AgentManifest, Stage } from "../types";

import { apiFetch } from "../lib/api";

interface Props {
  article: Article;
  onArticleUpdate?: () => void;   // called after serving run changes
}

// ── helpers ──────────────────────────────────────────────────────────────────

function overallBadge(status: string) {
  const cls: Record<string, string> = {
    done:    "bg-green-900 text-green-300",
    failed:  "bg-red-900 text-red-300",
    running: "bg-blue-900 text-blue-300",
    pending: "bg-gray-700 text-gray-400",
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${cls[status] ?? "bg-gray-700 text-gray-400"}`}>
      {status}
    </span>
  );
}

function stageDot(status: string) {
  const cls: Record<string, string> = {
    done:    "text-green-400",
    failed:  "text-red-400",
    running: "text-blue-400 animate-pulse",
    pending: "text-gray-600",
  };
  return <span className={cls[status] ?? "text-gray-600"}>●</span>;
}

function fmtElapsed(s: number | null) {
  if (!s) return null;
  return s < 60 ? `${s.toFixed(0)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

// ── ComparePane ───────────────────────────────────────────────────────────────

function ComparePane({
  runs, label,
}: {
  runs: AnalysisRun[];
  label: string;
}) {
  const doneRuns = runs.filter(r => r.overall_status === "done");
  const [runId, setRunId] = useState<number | null>(doneRuns[0]?.id ?? null);

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-700">
        <span className="text-xs text-gray-400 shrink-0">{label}</span>
        <select
          value={runId ?? ""}
          onChange={e => setRunId(Number(e.target.value) || null)}
          className="flex-1 min-w-0 bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1"
        >
          <option value="">— 选择 run —</option>
          {doneRuns.map(r => (
            <option key={r.id} value={r.id}>
              #{r.id} {r.agent_commit_hash.slice(0, 7)} · {r.backend}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-hidden p-2">
        {runId ? (
          <FileViewer runId={runId} />
        ) : (
          <div className="text-gray-500 text-sm text-center py-8">请选择一个 run</div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ArticleAdminPanel({ article, onArticleUpdate }: Props) {
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [selectedHash, setSelectedHash] = useState<string>("");
  const [manifest, setManifest] = useState<AgentManifest | null>(null);
  const [backend, setBackend] = useState<string>("claude");
  const [triggering, setTriggering] = useState(false);

  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [viewingRunId, setViewingRunId] = useState<number | null>(null);

  const [compareMode, setCompareMode] = useState(false);

  // Load agent versions (HEAD version includes manifest)
  useEffect(() => {
    apiFetch(`/agent/versions?n=20`)
      .then(r => r.json())
      .then(resp => {
        const vs: AgentVersion[] = resp.data ?? [];
        setVersions(vs);
        if (vs.length > 0) {
          setSelectedHash(vs[0].hash);
          if (vs[0].manifest) {
            setManifest(vs[0].manifest);
            if (vs[0].manifest.default_backend) setBackend(vs[0].manifest.default_backend);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Fetch manifest when user selects a different agent version
  useEffect(() => {
    if (!selectedHash) return;
    const v = versions.find(v => v.hash === selectedHash);
    if (v?.manifest) { setManifest(v.manifest); return; }
    apiFetch(`/agent/versions/${selectedHash}/manifest`)
      .then(r => r.json())
      .then(resp => {
        const m = resp.data as AgentManifest;
        setManifest(m);
        // Cache it on the version object
        setVersions(prev => prev.map(v =>
          v.hash === selectedHash ? { ...v, manifest: m } : v
        ));
      })
      .catch(() => {});
  }, [selectedHash]);

  const loadRuns = () =>
    apiFetch(`/articles/${article.id}/runs`)
      .then(r => r.json())
      .then(resp => setRuns(resp.data ?? []));

  useEffect(() => { loadRuns(); }, [article.id]);

  // ── Trigger ────────────────────────────────────────────────────────────────

  const triggerAnalysis = async () => {
    if (!selectedHash) return;
    setTriggering(true);
    try {
      const resp = await apiFetch(`/articles/${article.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_commit_hash: selectedHash, backend }),
      }).then(r => r.json());
      if (resp.run_id) {
        await loadRuns();
        setExpandedRunId(resp.run_id);
        setCompareMode(false);
      }
    } finally {
      setTriggering(false);
    }
  };

  const retriggerStage = async (runId: number, stage: Stage) => {
    await apiFetch(`/runs/${runId}/stage/${stage}`, { method: "POST" });
    loadRuns();
  };

  // ── Serving control ────────────────────────────────────────────────────────

  const setServingRun = async (runId: number | null) => {
    await apiFetch(`/articles/${article.id}/serving-run`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId }),
    });
    onArticleUpdate?.();
  };

  const handleRunUpdate = (updated: AnalysisRun) =>
    setRuns(prev => prev.map(r => r.id === updated.id ? updated : r));

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden text-sm text-gray-200">

      {/* Trigger section */}
      <div className="px-4 py-3 border-b border-gray-700 space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 uppercase tracking-wide">触发新分析</span>
          <button
            onClick={() => setCompareMode(v => !v)}
            title={compareMode ? "切换为历史列表" : "对比模式"}
            className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${
              compareMode
                ? "bg-purple-700 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {compareMode ? <List size={13} /> : <Columns2 size={13} />}
            {compareMode ? "历史列表" : "对比模式"}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={selectedHash}
            onChange={e => setSelectedHash(e.target.value)}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1.5"
          >
            {versions.length === 0 && <option value="">（未连接 agent repo）</option>}
            {versions.map(v => (
              <option key={v.hash} value={v.hash}>
                {v.short_hash} — {v.message.slice(0, 45)}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            {(manifest ? Object.keys(manifest.backends) : ["claude"]).map(b => (
              <button key={b} onClick={() => setBackend(b)}
                title={manifest?.backends[b]?.description}
                className={`px-2.5 py-1.5 text-xs rounded transition-colors ${
                  backend === b ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}>
                {b}
              </button>
            ))}
          </div>
          <button onClick={triggerAnalysis} disabled={triggering || !selectedHash}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600
                       disabled:opacity-50 text-white text-xs rounded transition-colors">
            {triggering ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
            一条龙运行
          </button>
        </div>
        {/* Manifest info */}
        {manifest && (
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>阶段: {manifest.stages.join(" → ")}</span>
            <span className="text-gray-600">|</span>
            <span>当前后端: <span className="text-blue-400">{backend}</span>
              {manifest.backends[backend]?.description && (
                <span className="text-gray-600 ml-1">({manifest.backends[backend].description})</span>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {compareMode ? (
          /* ── Compare view ── */
          <div className="flex h-full divide-x divide-gray-700">
            <ComparePane runs={runs} label="版本 A" />
            <ComparePane runs={runs} label="版本 B" />
          </div>
        ) : (
          /* ── History list ── */
          <div className="flex-1 overflow-y-auto">
            {runs.length === 0 ? (
              <div className="text-center text-gray-500 py-12">暂无分析记录</div>
            ) : (
              runs.map(run => {
                const isExpanded = expandedRunId === run.id;
                const isViewing  = viewingRunId === run.id;
                const isServing  = article.serving_run_id === run.id;

                return (
                  <div key={run.id} className="border-b border-gray-700/60">
                    {/* Run header */}
                    <div
                      className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-800/50 cursor-pointer"
                      onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    >
                      {isExpanded
                        ? <ChevronDown size={13} className="text-gray-500 shrink-0" />
                        : <ChevronRight size={13} className="text-gray-500 shrink-0" />}
                      <span className="text-gray-400 text-xs w-5 shrink-0">#{run.id}</span>
                      <span className="text-xs font-mono text-blue-400 shrink-0">
                        {run.agent_commit_hash.slice(0, 7)}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">{run.backend}</span>
                      <span className="flex-1 truncate text-xs text-gray-500">
                        {run.agent_commit_message}
                      </span>
                      <span className="text-xs text-gray-500 shrink-0">{fmtDate(run.created_at)}</span>
                      {isServing && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-800 text-blue-200 shrink-0">
                          推送中
                        </span>
                      )}
                      {overallBadge(run.overall_status)}
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-10 pb-3 space-y-3">
                        <RunProgress run={run} stages={manifest?.stages ?? []} onUpdate={handleRunUpdate} />

                        {/* Stage re-trigger */}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {(manifest?.stages ?? []).map(stage => {
                            const status  = run[`${stage}_status` as keyof AnalysisRun] as string;
                            const elapsed = run[`${stage}_elapsed_s` as keyof AnalysisRun] as number | null;
                            return (
                              <button key={stage}
                                onClick={() => retriggerStage(run.id, stage)}
                                className="flex items-center gap-1 px-2 py-1 text-xs
                                           bg-gray-700 hover:bg-gray-600 rounded transition-colors">
                                {stageDot(status)}
                                <span className="capitalize">{stage}</span>
                                {elapsed && <span className="text-gray-500">{fmtElapsed(elapsed)}</span>}
                                <RefreshCw size={10} className="text-gray-500" />
                              </button>
                            );
                          })}
                        </div>

                        {/* Serving + view controls */}
                        <div className="flex items-center gap-3 pt-0.5">
                          {run.overall_status === "done" && (
                            <>
                              <button
                                onClick={() => setServingRun(isServing ? null : run.id)}
                                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${
                                  isServing
                                    ? "bg-blue-700 text-white"
                                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                }`}>
                                <Radio size={11} />
                                {isServing ? "✓ 当前推送（点击取消）" : "设为推送版本"}
                              </button>
                              <button
                                onClick={() => setViewingRunId(isViewing ? null : run.id)}
                                className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300">
                                <Eye size={12} />
                                {isViewing ? "收起产出" : "查看产出"}
                              </button>
                            </>
                          )}
                        </div>

                        {isViewing && viewingRunId === run.id && (
                          <div className="border border-gray-700 rounded p-3 bg-gray-900"
                               style={{ height: 400, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                            <FileViewer runId={run.id} />
                          </div>
                        )}

                        {run.error_msg && (
                          <div className="text-xs text-red-400 bg-red-900/20 rounded p-2">
                            {run.error_msg}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
