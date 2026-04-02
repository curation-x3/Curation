import { useEffect, useRef, useState } from "react";
import { CheckCircle, XCircle, Loader2, Clock } from "lucide-react";
import type { AnalysisRun, Stage } from "../types";
import { apiFetch, getAuthToken, getWsBase } from "../lib/api";

interface Props {
  run: AnalysisRun;
  stages: string[];
  onUpdate: (updated: AnalysisRun) => void;
}

function fmt(s: number | null): string {
  if (s === null) return "";
  if (s < 60) return `${s.toFixed(0)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function StageRow({ stage, run }: { stage: Stage; run: AnalysisRun }) {
  const status = run[`${stage}_status` as keyof AnalysisRun] as string;
  const elapsed = run[`${stage}_elapsed_s` as keyof AnalysisRun] as number | null;

  const icon =
    status === "done" ? <CheckCircle size={14} className="text-green-400" /> :
    status === "failed" ? <XCircle size={14} className="text-red-400" /> :
    status === "running" ? <Loader2 size={14} className="animate-spin text-blue-400" /> :
    <Clock size={14} className="text-gray-500" />;

  const barPct =
    status === "done" ? 100 :
    status === "running" ? 60 :
    0;

  return (
    <div className="flex items-center gap-3 py-1.5">
      {icon}
      <span className="w-24 text-sm capitalize text-gray-300">{stage}</span>
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            status === "done" ? "bg-green-500" :
            status === "failed" ? "bg-red-500" :
            status === "running" ? "bg-blue-400 animate-pulse" :
            "bg-gray-600"
          }`}
          style={{ width: `${barPct}%` }}
        />
      </div>
      <span className="w-12 text-right text-xs text-gray-500">
        {elapsed ? fmt(elapsed) : status === "running" ? "…" : ""}
      </span>
    </div>
  );
}

export function RunProgress({ run, stages, onUpdate }: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const [localRun, setLocalRun] = useState<AnalysisRun>(run);

  useEffect(() => {
    setLocalRun(run);
  }, [run]);

  useEffect(() => {
    // Only connect if run is active
    if (!["pending", "running"].includes(run.overall_status)) return;

    const token = getAuthToken();
    if (!token) return;

    const wsBase = getWsBase();
    const qs = new URLSearchParams({ token });
    const ws = new WebSocket(`${wsBase}/runs/${run.id}/progress?${qs.toString()}`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === "snapshot") {
          setLocalRun(event.data);
          onUpdate(event.data);
        } else if (event.type === "stage_start" || event.type === "stage_end") {
          apiFetch(`/runs/${run.id}`)
            .then(r => r.json())
            .then(resp => {
              if (resp.data) {
                setLocalRun(resp.data);
                onUpdate(resp.data);
              }
            });
        } else if (event.type === "done" || event.type === "failed") {
          apiFetch(`/runs/${run.id}`)
            .then(r => r.json())
            .then(resp => {
              if (resp.data) {
                setLocalRun(resp.data);
                onUpdate(resp.data);
              }
            });
          ws.close();
        }
      } catch {}
    };

    return () => {
      ws.close();
    };
  }, [run.id, run.overall_status]);

  const totalElapsed = stages
    .map(s => localRun[`${s}_elapsed_s` as keyof AnalysisRun] as number | null)
    .reduce((a, b) => (a ?? 0) + (b ?? 0), 0);

  return (
    <div className="space-y-0.5">
      {stages.map(stage => (
        <StageRow key={stage} stage={stage} run={localRun} />
      ))}
      {totalElapsed !== null && totalElapsed > 0 && (
        <div className="pt-1 text-right text-xs text-gray-500">
          合计 {fmt(totalElapsed)}
        </div>
      )}
    </div>
  );
}
