import { useEffect, useState } from "react";
import { Play, RefreshCw, ChevronDown, ChevronRight, Eye, Columns2, List, Radio, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { RunProgress } from "./RunProgress";
import { FileViewer } from "./FileViewer";
import type { Article, AnalysisRun, AgentBackends } from "../types";

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
              #{r.id} · {r.backend}
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
  const [backend, setBackend] = useState<string>("claude");
  const [triggering, setTriggering] = useState(false);

  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [viewingRunId, setViewingRunId] = useState<number | null>(null);

  const [compareMode, setCompareMode] = useState(false);

  // Load available backends from agent
  const { data: backendsInfo, isLoading: isLoadingBackends } = useQuery({
    queryKey: ["analysisBackends"],
    queryFn: async () => {
      const resp = await apiFetch(`/agent/backends`).then(r => r.json());
      return (resp.data as AgentBackends) ?? null;
    },
    staleTime: 60 * 1000,
  });

  // Set default backend when data loads
  useEffect(() => {
    if (backendsInfo?.default) setBackend(backendsInfo.default);
  }, [backendsInfo]);

  const { isLoading: isLoadingRuns } = useQuery({
    queryKey: ["articleRuns", article.short_id],
    queryFn: async () => {
      const resp = await apiFetch(`/articles/${article.short_id}/runs`).then(r => r.json());
      const data = resp.data ?? [];
      setRuns(data);
      return data;
    },
  });

  const loadRuns = () =>
    apiFetch(`/articles/${article.short_id}/runs`)
      .then(r => r.json())
      .then(resp => setRuns(resp.data ?? []));

  // ── Trigger ────────────────────────────────────────────────────────────────

  const triggerAnalysis = async () => {
    setTriggering(true);
    try {
      const resp = await apiFetch(`/articles/${article.short_id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend }),
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

  // ── Serving control ────────────────────────────────────────────────────────

  const setServingRun = async (runId: number | null) => {
    await apiFetch(`/articles/${article.short_id}/serving-run`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId }),
    });
    onArticleUpdate?.();
  };

  const deleteRun = async (runId: number) => {
    if (!confirm("确定删除此分析记录？关联的卡片也会被删除。")) return;
    await apiFetch(`/runs/${runId}`, { method: "DELETE" });
    await loadRuns();
    onArticleUpdate?.();
  };

  const handleRunUpdate = (updated: AnalysisRun) =>
    setRuns(prev => prev.map(r => r.id === updated.id ? updated : r));

  const backendNames = backendsInfo ? Object.keys(backendsInfo.backends) : ["claude"];

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
        <div className="flex gap-2 flex-wrap items-center">
          <div className="flex gap-1">
            {backendNames.map(b => (
              <button key={b} onClick={() => setBackend(b)}
                title={backendsInfo?.backends[b]?.description}
                className={`px-2.5 py-1.5 text-xs rounded transition-colors ${
                  backend === b ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}>
                {b}
              </button>
            ))}
          </div>
          <button onClick={triggerAnalysis} disabled={triggering}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600
                       disabled:opacity-50 text-white text-xs rounded transition-colors">
            {triggering ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
            一条龙运行
          </button>
        </div>
        {/* Backend info */}
        {backendsInfo?.backends[backend]?.description && (
          <div className="text-xs text-gray-500">
            当前后端: <span className="text-blue-400">{backend}</span>
            <span className="text-gray-600 ml-1">({backendsInfo.backends[backend].description})</span>
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
            {(isLoadingRuns || isLoadingBackends) ? (
              <div className="text-center text-gray-500 py-12">加载中...</div>
            ) : runs.length === 0 ? (
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
                      <span className="text-xs text-gray-400 shrink-0">{run.backend}</span>
                      {run.elapsed_s != null && (
                        <span className="text-xs text-gray-500 shrink-0">{fmtElapsed(run.elapsed_s)}</span>
                      )}
                      <span className="flex-1" />
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
                        <RunProgress run={run} onUpdate={handleRunUpdate} />

                        {/* Serving + view + delete controls */}
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
                          <button
                            onClick={() => deleteRun(run.id)}
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors bg-gray-700 text-gray-300 hover:bg-red-900 hover:text-red-300">
                            <Trash2 size={11} />
                            删除
                          </button>
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
