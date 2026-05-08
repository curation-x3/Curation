import { useState, useEffect } from "react";
import { ArrowUpRight, FolderOpen, RefreshCw, FileDown } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { openFolderPicker } from "../lib/platform/dialog";
import { TauriOnly } from "./platform/TauriOnly";
import {
  checkAcpEnvironment,
  exportDiagnostics,
  getAcpMaxAlive,
  setAcpMaxAlive,
  type AgentEnvironmentCheck,
} from "../lib/chat";
import type { AppearanceSettings, FontBody, ThemeMode } from "../lib/appearance";
import {
  READER_SIZE_DEFAULT,
  READER_SIZE_MAX,
  READER_SIZE_MIN,
  READER_WIDTH_DEFAULT,
  READER_WIDTH_MAX,
  READER_WIDTH_MIN,
  READER_WIDTH_STEP,
  ROOT_SIZE_MAX,
  ROOT_SIZE_MIN,
  resolveTheme,
} from "../lib/appearance";

interface Props {
  draft: AppearanceSettings;
  autoSize: number;
  currentUserEmail: string;
  notesPath: string;
  appVersion: string;
  onNotesPathChange: (path: string) => void;
  onChange: (patch: Partial<AppearanceSettings>) => void;
  onReset: () => void;
  onLogout: () => void;
}

export const THEME_OPTIONS: { key: ThemeMode; label: string; glyph: string; hint: string }[] = [
  { key: "light", label: "日", glyph: "☀", hint: "Daylight" },
  { key: "dark", label: "夜", glyph: "☾", hint: "Nightfall" },
  { key: "auto", label: "随", glyph: "◐", hint: "Follow system" },
];

export const FONT_OPTIONS: { key: FontBody; label: string; glyph: string; glyphFamily: string }[] = [
  {
    key: "serif",
    label: "衬线",
    glyph: "Aa",
    glyphFamily: `"Charter", "Bitstream Charter", "Georgia", "Noto Serif SC", serif`,
  },
  {
    key: "sans",
    label: "无衬线",
    glyph: "Aa",
    glyphFamily: `-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif`,
  },
  {
    key: "mono",
    label: "等宽",
    glyph: "Aa",
    glyphFamily: `"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`,
  },
];

function Section({ roman, title, children }: { roman: string; title: string; children: React.ReactNode }) {
  return (
    <section className="ts-section">
      <div className="ts-section-head">
        <span className="ts-roman">{roman}</span>
        <span className="ts-section-title">{title}</span>
        <span className="ts-section-rule" />
      </div>
      <div className="ts-section-body">{children}</div>
    </section>
  );
}

interface PrecisionSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  valueLabel: string;
  ariaLabel: string;
  leftGlyph?: string;
  rightGlyph?: string;
  ticks?: number[];
}

function PrecisionSlider({
  min,
  max,
  step,
  value,
  onChange,
  valueLabel,
  ariaLabel,
  leftGlyph,
  rightGlyph,
  ticks = [],
}: PrecisionSliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="ts-slider">
      {leftGlyph && <span className="ts-slider-glyph ts-slider-glyph-sm">{leftGlyph}</span>}
      <div className="ts-slider-track-wrap">
        <div className="ts-slider-track" />
        {ticks.map((t) => {
          const tp = ((t - min) / (max - min)) * 100;
          return <span key={t} className="ts-slider-tick" style={{ left: `${tp}%` }} />;
        })}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={ariaLabel}
          className="ts-slider-input"
          style={{ ["--slider-fill" as any]: `${pct}%` }}
        />
      </div>
      {rightGlyph && <span className="ts-slider-glyph ts-slider-glyph-lg">{rightGlyph}</span>}
      <span className="ts-slider-value">{valueLabel}</span>
    </div>
  );
}

function WidthRuler({ value, min, max }: { value: number; min: number; max: number }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="ts-ruler" aria-hidden>
      <span className="ts-ruler-bar" style={{ width: `${pct}%` }} />
    </div>
  );
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
      // revert on failure
      const current = await getAcpMaxAlive().catch(() => value);
      setValue(current);
    }
  };

  return (
    <div className="ts-field">
      <div className="ts-field-label">
        <span>最多并行会话</span>
        <span className="ts-field-hint">1–5，超出后自动回收已结束的空闲会话</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          className="ts-footer-btn"
          style={{ padding: "4px 10px", fontSize: "var(--fs-sm)" }}
          onClick={() => update(value - 1)}
          disabled={!loaded || value <= 1}
        >
          −
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setChecks(await checkAcpEnvironment());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="ts-field">
      <div className="ts-field-label">
        <span>本机 Agent 环境</span>
        <button className="ts-icon-btn" onClick={refresh} disabled={loading} title="重新检查">
          <RefreshCw size={13} className={loading ? "spinning" : ""} />
        </button>
      </div>
      {error && <div className="ts-diagnostic-error">{error}</div>}
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
      const nextPath = await exportDiagnostics();
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
        <span className="ts-field-hint">环境、Agent 检查、运行信息</span>
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

export function SettingsDrawerBody({
  draft,
  autoSize,
  currentUserEmail,
  notesPath,
  appVersion,
  onNotesPathChange,
  onChange,
  onReset,
  onLogout,
}: Props) {
  const systemSize = draft.rootSizeOverride ?? autoSize;
  const isAuto = draft.rootSizeOverride === null;

  return (
    <div className="drawer-body drawer-body-settings">
      <div className="drawer-settings-title">
        <span className="drawer-settings-title-serif">Settings</span>
        <span className="drawer-settings-title-sans">设置</span>
      </div>

      {/* Section I. 主题 */}
      <Section roman="I" title="主题">
        <div className="ts-themes">
          {THEME_OPTIONS.map((opt) => {
            const isActive = draft.theme === opt.key;
            const resolved = opt.key === "auto" ? resolveTheme("auto") : opt.key;
            return (
              <button
                key={opt.key}
                className={`ts-theme ${isActive ? "active" : ""}`}
                onClick={() => onChange({ theme: opt.key })}
                data-resolved={resolved}
              >
                <span className="ts-theme-glyph" aria-hidden>{opt.glyph}</span>
                <span className="ts-theme-label">{opt.label}</span>
                <span className="ts-theme-hint">{opt.hint}</span>
                {opt.key === "auto" && isActive && (
                  <span className="ts-theme-resolved">→ {resolved === "light" ? "日" : "夜"}</span>
                )}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Section II. 阅读 */}
      <Section roman="II" title="阅读">
        <div className="ts-field">
          <div className="ts-field-label">
            <span>字号</span>
            <span className="ts-field-hint">⌘ + / ⌘ − / ⌘ 0</span>
          </div>
          <PrecisionSlider
            min={READER_SIZE_MIN}
            max={READER_SIZE_MAX}
            step={1}
            value={draft.readerSize}
            onChange={(v) => onChange({ readerSize: v })}
            ariaLabel="阅读字号"
            leftGlyph="A"
            rightGlyph="A"
            valueLabel={`${draft.readerSize} pt`}
            ticks={[READER_SIZE_DEFAULT]}
          />
          {draft.readerSize !== READER_SIZE_DEFAULT && (
            <button
              className="ts-linklet"
              onClick={() => onChange({ readerSize: READER_SIZE_DEFAULT })}
            >
              ↺ 回到 {READER_SIZE_DEFAULT} pt
            </button>
          )}
        </div>

        <div className="ts-field">
          <div className="ts-field-label">
            <span>栏宽</span>
          </div>
          <PrecisionSlider
            min={READER_WIDTH_MIN}
            max={READER_WIDTH_MAX}
            step={READER_WIDTH_STEP}
            value={draft.readerMaxWidth}
            onChange={(v) => onChange({ readerMaxWidth: v })}
            ariaLabel="阅读栏宽"
            leftGlyph="▏"
            rightGlyph="▎"
            valueLabel={`${draft.readerMaxWidth} px`}
            ticks={[READER_WIDTH_DEFAULT]}
          />
          <WidthRuler
            value={draft.readerMaxWidth}
            min={READER_WIDTH_MIN}
            max={READER_WIDTH_MAX}
          />
        </div>
      </Section>

      {/* Section III. 字体 */}
      <Section roman="III" title="字体">
        <div className="ts-typefaces">
          {FONT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={`ts-typeface ${draft.fontBody === opt.key ? "active" : ""}`}
              onClick={() => onChange({ fontBody: opt.key })}
            >
              <span
                className="ts-typeface-glyph"
                style={{ fontFamily: opt.glyphFamily }}
                aria-hidden
              >
                Aa
              </span>
              <span className="ts-typeface-label">{opt.label}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* Section IV. 系统 */}
      <Section roman="IV" title="系统">
        <div className="ts-field">
          <div className="ts-field-label">
            <span>界面字号</span>
            {isAuto && <span className="ts-auto-tag">AUTO · {autoSize} pt</span>}
          </div>
          <PrecisionSlider
            min={ROOT_SIZE_MIN}
            max={ROOT_SIZE_MAX}
            step={1}
            value={systemSize}
            onChange={(v) => onChange({ rootSizeOverride: v })}
            ariaLabel="系统字号"
            leftGlyph="a"
            rightGlyph="A"
            valueLabel={`${systemSize} pt`}
            ticks={[autoSize]}
          />
          {!isAuto && (
            <button
              className="ts-linklet"
              onClick={() => onChange({ rootSizeOverride: null })}
            >
              ↺ 跟随视口（{autoSize} pt）
            </button>
          )}
        </div>
      </Section>

      {/* Section V. 笔记 (Tauri only) */}
      <TauriOnly>
        <Section roman="V" title="笔记">
          <div className="ts-field">
            <div className="ts-field-label">
              <span>笔记路径</span>
              <span className="ts-field-hint">保存卡片到本地笔记系统</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  flex: 1,
                  background: "var(--bg-base)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  color: notesPath ? "var(--text-primary)" : "var(--text-muted)",
                  fontSize: "var(--fs-sm)",
                  fontFamily: "var(--font-mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {notesPath || "未设置"}
              </div>
              <button
                className="ts-footer-btn primary"
                style={{ padding: "5px 12px", fontSize: "var(--fs-sm)", display: "flex", alignItems: "center", gap: 4 }}
                onClick={async () => {
                  const selected = await openFolderPicker({
                    title: "选择笔记文件夹",
                    defaultPath: notesPath || undefined,
                  });
                  if (selected) {
                    onNotesPathChange(selected);
                  }
                }}
              >
                <FolderOpen size={13} />
                选择
              </button>
            </div>
          </div>
        </Section>
      </TauriOnly>

      {/* Section VI. Agent (Tauri only) */}
      <TauriOnly>
        <Section roman="VI" title="Agent">
          <AgentEnvironmentPanel />
          <AcpMaxAliveField />
        </Section>
      </TauriOnly>

      {/* Section VII. 诊断 (Tauri only) */}
      <TauriOnly>
        <Section roman="VII" title="诊断">
          <DiagnosticsExportField />
        </Section>
      </TauriOnly>

      {/* Section VIII. 账号 */}
      <Section roman="VIII" title="账号">
        <div className="ts-account">
          <div className="ts-account-row">
            <span className="ts-account-label">已登录</span>
            <span className="ts-account-email">{currentUserEmail}</span>
          </div>
          <button className="ts-signout" onClick={onLogout}>
            <span>退出登录</span>
            <ArrowUpRight size={13} />
          </button>
        </div>
      </Section>

      <div className="drawer-footer drawer-footer-settings">
        <button className="ts-footer-link" onClick={onReset}>恢复默认</button>
        <span>v{appVersion}</span>
        <span className="drawer-sync-status">● 已同步</span>
      </div>
    </div>
  );
}
