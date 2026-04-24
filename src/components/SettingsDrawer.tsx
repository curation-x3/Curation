import { useState } from "react";
import { X, ArrowUpRight, FolderOpen } from "lucide-react";
import { openFolderPicker } from "../lib/platform/dialog";
import { TauriOnly } from "./platform/TauriOnly";
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
  open: boolean;
  draft: AppearanceSettings;
  autoSize: number;
  currentUserEmail: string;
  notesPath: string;
  onNotesPathChange: (path: string) => void;
  onClose: () => void;
  onChange: (patch: Partial<AppearanceSettings>) => void;
  onReset: () => void;
  onLogout: () => void;
}

const THEME_OPTIONS: { key: ThemeMode; label: string; glyph: string; hint: string }[] = [
  { key: "light", label: "日", glyph: "☀", hint: "Daylight" },
  { key: "dark", label: "夜", glyph: "☾", hint: "Nightfall" },
  { key: "auto", label: "随", glyph: "◐", hint: "Follow system" },
];

const FONT_OPTIONS: { key: FontBody; label: string; glyph: string; glyphFamily: string }[] = [
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

interface SectionProps {
  roman: string;
  title: string;
  children: React.ReactNode;
  stagger: number;
}

function Section({ roman, title, children, stagger }: SectionProps) {
  return (
    <section className="ts-section" style={{ animationDelay: `${40 + stagger * 80}ms` }}>
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

export function SettingsDrawer({
  open,
  draft,
  autoSize,
  currentUserEmail,
  notesPath,
  onNotesPathChange,
  onClose,
  onChange,
  onReset,
  onLogout,
}: Props) {
  if (!open) return null;

  const systemSize = draft.rootSizeOverride ?? autoSize;
  const isAuto = draft.rootSizeOverride === null;

  const handleClose = onClose;

  const [tab, setTab] = useState<"appearance" | "general">("appearance");

  return (
    <div className="settings-drawer-overlay" onClick={handleClose}>
      <aside
        className="settings-drawer-panel ts-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="设置"
      >
        <header className="ts-header">
          <div className="ts-masthead">
            <span className="ts-masthead-serif">设置</span>
            <span className="ts-masthead-rule" />
            <span className="ts-masthead-sans">SETTINGS</span>
          </div>
          <button className="ts-close" onClick={handleClose} aria-label="关闭">
            <X size={15} />
          </button>
        </header>

        <div className="ts-tabs">
          <button
            className={`ts-tab ${tab === "appearance" ? "active" : ""}`}
            onClick={() => setTab("appearance")}
          >
            外观
          </button>
          <button
            className={`ts-tab ${tab === "general" ? "active" : ""}`}
            onClick={() => setTab("general")}
          >
            通用
          </button>
        </div>

        <div className="ts-body">
          {tab === "appearance" && <>
          <Section roman="I" title="主题" stagger={0}>
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

          <Section roman="II" title="阅读" stagger={1}>
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

          <Section roman="III" title="字体" stagger={2}>
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

          <Section roman="IV" title="系统" stagger={3}>
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
          </>}

          {tab === "general" && <>
          <TauriOnly>
            <Section roman="V" title="笔记" stagger={0}>
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

          <Section roman="VI" title="账号" stagger={1}>
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

          </>}

          <div className="ts-imprint" aria-hidden>
            Curation · 个人资讯系统 · 由你调整，为你编排
          </div>
        </div>

        <footer className="ts-footer">
          <button className="ts-footer-link" onClick={onReset}>
            恢复默认
          </button>
          <div style={{ flex: 1 }} />
          <span className="ts-autosave-note">更改即刻保存</span>
          <button className="ts-footer-btn primary" onClick={handleClose}>
            完成
          </button>
        </footer>
      </aside>
    </div>
  );
}
