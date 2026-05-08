import { useEffect, useState } from "react";
import type React from "react";
import { FileDown, RefreshCw } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getConsoleDiagnosticsPayload } from "../lib/diagnostics/consoleCapture";
import {
  checkAcpEnvironment,
  exportDiagnostics,
  getAcpMaxAlive,
  setAcpMaxAlive,
  type AgentEnvironmentCheck,
} from "../lib/chat";

type SectionComponent = (props: {
  roman: string;
  title: string;
  children: React.ReactNode;
}) => React.ReactElement;

interface Props {
  Section: SectionComponent;
}

function AcpMaxAliveField() {
  const [value, setValue] = useState<number>(3);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getAcpMaxAlive()
      .then((n) => {
        setValue(n);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const update = async (next: number) => {
    const clamped = Math.max(1, Math.min(5, next));
    setValue(clamped);
    try {
      await setAcpMaxAlive(clamped);
    } catch {
      const current = await getAcpMaxAlive().catch(() => value);
      setValue(current);
    }
  };

  return (
    <div className="ts-field">
      <div className="ts-field-label">
        <span>最多并行会话</span>
        <span className="ts-field-hint">1-5，超出后自动回收已结束的空闲会话</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          className="ts-footer-btn"
          style={{ padding: "4px 10px", fontSize: "var(--fs-sm)" }}
          onClick={() => update(value - 1)}
          disabled={!loaded || value <= 1}
        >
          -
        </button>
        <span style={{ minWidth: 32, textAlign: "center", fontFamily: "var(--font-mono)" }}>
          {value}
        </span>
        <button
          className="ts-footer-btn"
          style={{ padding: "4px 10px", fontSize: "var(--fs-sm)" }}
          onClick={() => update(value + 1)}
          disabled={!loaded || value >= 5}
        >
          +
        </button>
      </div>
    </div>
  );
}

function statusLabel(ok: boolean) {
  return ok ? "Ready" : "Missing";
}

function AgentEnvironmentPanel() {
  const [checks, setChecks] = useState<AgentEnvironmentCheck[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setChecks(await checkAcpEnvironment());
      setHasChecked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHasChecked(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ts-field">
      <div className="ts-field-label">
        <span>本机 Agent 环境</span>
        <button className="ts-icon-btn" onClick={refresh} disabled={loading} title="检查">
          <RefreshCw size={13} className={loading ? "spinning" : ""} />
        </button>
      </div>
      {!hasChecked && (
        <button className="ts-footer-btn primary" onClick={refresh} disabled={loading}>
          <RefreshCw size={13} className={loading ? "spinning" : ""} />
          {loading ? "检查中" : "检查 Agent 环境"}
        </button>
      )}
      {error && <div className="ts-diagnostic-error">{error}</div>}
      {hasChecked && (
        <div className="ts-agent-grid">
          {checks.map((check) => (
            <div key={check.id} className={`ts-agent-card ${check.detected ? "ready" : "blocked"}`}>
              <div className="ts-agent-card-head">
                <span>{check.name}</span>
                <span>{statusLabel(check.detected)}</span>
              </div>
              <div className="ts-agent-lines">
                <EnvLine label="CLI" ok={check.cli.available} detail={check.cli.version || check.cli.error || check.cli.path} />
                <EnvLine label="Launcher" ok={check.launcher.available} detail={check.launcher.version || check.launcher.error || check.launcher.path} />
                <EnvLine
                  label="Adapter"
                  ok={check.adapter.ready}
                  detail={
                    check.adapter.checked
                      ? check.adapter.error || check.adapter.package || "ready"
                      : "native"
                  }
                />
              </div>
            </div>
          ))}
          {!loading && checks.length === 0 && (
            <div className="ts-diagnostic-error">当前环境未返回 Agent 检查结果</div>
          )}
        </div>
      )}
    </div>
  );
}

function EnvLine({ label, ok, detail }: { label: string; ok: boolean; detail?: string | null }) {
  return (
    <div className="ts-agent-line">
      <span className={`ts-status-dot ${ok ? "ok" : "bad"}`} />
      <span className="ts-agent-line-label">{label}</span>
      <span className="ts-agent-line-detail">{detail || (ok ? "ready" : "missing")}</span>
    </div>
  );
}

function DiagnosticsExportField() {
  const [exporting, setExporting] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const payload = getConsoleDiagnosticsPayload();
      const nextPath = await exportDiagnostics(payload);
      setPath(nextPath);
      await revealItemInDir(nextPath).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="ts-field">
      <div className="ts-field-label">
        <span>诊断包</span>
        <span className="ts-field-hint">前端 Console、运行环境、Agent 检查、系统日志附录</span>
      </div>
      <div className="ts-diagnostic-row">
        <button className="ts-footer-btn primary" onClick={runExport} disabled={exporting}>
          <FileDown size={13} />
          {exporting ? "导出中" : "导出诊断包"}
        </button>
        {path && (
          <button className="ts-footer-btn" onClick={() => revealItemInDir(path)}>
            在 Finder 中显示
          </button>
        )}
      </div>
      {path && <div className="ts-diagnostic-path">{path}</div>}
      {error && <div className="ts-diagnostic-error">{error}</div>}
    </div>
  );
}

export function SettingsAgentTab({ Section }: Props) {
  return (
    <>
      <Section roman="I" title="Agent">
        <AgentEnvironmentPanel />
        <AcpMaxAliveField />
      </Section>
      <Section roman="II" title="诊断">
        <DiagnosticsExportField />
      </Section>
    </>
  );
}
