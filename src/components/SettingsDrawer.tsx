import { X } from "lucide-react";
import type { AppearanceSettings, FontBody } from "../lib/appearance";
import {
  READER_SIZE_DEFAULT,
  READER_SIZE_MAX,
  READER_SIZE_MIN,
  READER_WIDTH_MAX,
  READER_WIDTH_MIN,
  READER_WIDTH_STEP,
  ROOT_SIZE_MAX,
  ROOT_SIZE_MIN,
} from "../lib/appearance";

interface Props {
  open: boolean;
  draft: AppearanceSettings;
  autoSize: number;
  onClose: () => void;
  onChange: (patch: Partial<AppearanceSettings>) => void;
  onCommit: () => void;
  onCancel: () => void;
  onReset: () => void;
}

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

export function SettingsDrawer({
  open,
  draft,
  autoSize,
  onClose,
  onChange,
  onCommit,
  onCancel,
  onReset,
}: Props) {
  if (!open) return null;

  const systemSize = draft.rootSizeOverride ?? autoSize;
  const isAuto = draft.rootSizeOverride === null;
  const systemPct = ((systemSize - ROOT_SIZE_MIN) / (ROOT_SIZE_MAX - ROOT_SIZE_MIN)) * 100;
  const readerPct = ((draft.readerSize - READER_SIZE_MIN) / (READER_SIZE_MAX - READER_SIZE_MIN)) * 100;
  const widthPct = ((draft.readerMaxWidth - READER_WIDTH_MIN) / (READER_WIDTH_MAX - READER_WIDTH_MIN)) * 100;

  const handleApply = () => {
    onCommit();
    onClose();
  };
  const handleCancel = () => {
    onCancel();
    onClose();
  };

  return (
    <div className="settings-drawer-overlay" onClick={handleCancel}>
      <aside
        className="settings-drawer-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="外观设置"
      >
        <header className="settings-drawer-header">
          <div className="settings-drawer-title">
            <span className="settings-drawer-title-serif">外观</span>
            <span className="settings-drawer-title-sans">SETTINGS</span>
          </div>
          <button className="btn-icon" onClick={handleCancel} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="settings-drawer-body">
          <section className="settings-section settings-section-stagger-1">
            <h4>
              <span>阅读字号</span>
              <span className="settings-hint-inline">快捷键 ⌘ +/−/0</span>
            </h4>
            <div className="settings-slider-row">
              <span className="settings-slider-edge">A</span>
              <input
                type="range"
                min={READER_SIZE_MIN}
                max={READER_SIZE_MAX}
                step={1}
                value={draft.readerSize}
                onChange={(e) => onChange({ readerSize: Number(e.target.value) })}
                aria-label="阅读字号"
                style={{ ["--slider-fill" as any]: `${readerPct}%` }}
              />
              <span className="settings-slider-edge" style={{ fontSize: "1.25rem" }}>A</span>
              <span className="settings-slider-value">{draft.readerSize}px</span>
            </div>
            <div className="settings-section-footer">
              <span className="settings-hint">默认 {READER_SIZE_DEFAULT}px</span>
              {draft.readerSize !== READER_SIZE_DEFAULT && (
                <button
                  className="settings-link-btn"
                  onClick={() => onChange({ readerSize: READER_SIZE_DEFAULT })}
                >
                  恢复默认
                </button>
              )}
            </div>
          </section>

          <section className="settings-section settings-section-stagger-2">
            <h4>
              <span>阅读宽度</span>
            </h4>
            <div className="settings-slider-row">
              <span className="settings-slider-edge" aria-hidden>▯</span>
              <input
                type="range"
                min={READER_WIDTH_MIN}
                max={READER_WIDTH_MAX}
                step={READER_WIDTH_STEP}
                value={draft.readerMaxWidth}
                onChange={(e) => onChange({ readerMaxWidth: Number(e.target.value) })}
                aria-label="阅读宽度"
                style={{ ["--slider-fill" as any]: `${widthPct}%` }}
              />
              <span className="settings-slider-edge" style={{ fontSize: "1.25rem" }} aria-hidden>▭</span>
              <span className="settings-slider-value">{draft.readerMaxWidth}px</span>
            </div>
          </section>

          <section className="settings-section settings-section-stagger-3">
            <h4>
              <span>正文字体</span>
            </h4>
            <div className="settings-segmented">
              {FONT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  className={`settings-seg-btn ${
                    draft.fontBody === opt.key ? "active" : ""
                  }`}
                  onClick={() => onChange({ fontBody: opt.key })}
                >
                  <span
                    className="settings-seg-glyph"
                    style={{ fontFamily: opt.glyphFamily }}
                  >
                    {opt.glyph}
                  </span>
                  <span className="settings-seg-label">{opt.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section settings-section-stagger-4">
            <h4>
              <span>系统字号</span>
              {isAuto && <span className="settings-auto-tag">AUTO</span>}
            </h4>
            <div className="settings-slider-row">
              <span className="settings-slider-edge">A</span>
              <input
                type="range"
                min={ROOT_SIZE_MIN}
                max={ROOT_SIZE_MAX}
                step={1}
                value={systemSize}
                onChange={(e) => onChange({ rootSizeOverride: Number(e.target.value) })}
                aria-label="系统字号"
                style={{ ["--slider-fill" as any]: `${systemPct}%` }}
              />
              <span className="settings-slider-edge" style={{ fontSize: "1.1rem" }}>A</span>
              <span className="settings-slider-value">{systemSize}px</span>
            </div>
            <div className="settings-section-footer">
              <span className="settings-hint">
                自动档位 {autoSize}px · 随视口宽度
              </span>
              {!isAuto && (
                <button
                  className="settings-link-btn"
                  onClick={() => onChange({ rootSizeOverride: null })}
                >
                  恢复自动
                </button>
              )}
            </div>
          </section>

          <section className="settings-section settings-section-stagger-5">
            <h4>
              <span>预览</span>
            </h4>
            <article className="settings-preview" aria-hidden>
              <div className="settings-preview-kicker">样例 · PREVIEW</div>
              <h2 className="settings-preview-title">
                在<em>喧嚣</em>的信息洪流中，仍要<em>认真</em>阅读
              </h2>
              <div className="settings-preview-meta">
                <span>远方播客</span>
                <span className="settings-preview-dot">·</span>
                <span>2026 年 4 月 20 日</span>
                <span className="settings-preview-dot">·</span>
                <span>5 分钟</span>
              </div>
              <p className="settings-preview-body" style={{ fontSize: `${draft.readerSize}px` }}>
                这是一段用于展示当前<strong>字号、字体族和阅读宽度</strong>的正文样例。
                调整上面任一设置，这段文字会立刻随之改变。
                合适的排版不喧宾夺主，它只是让句子更容易被读完。
              </p>
            </article>
          </section>
        </div>

        <footer className="settings-drawer-footer">
          <button className="settings-link-btn settings-reset-btn" onClick={onReset}>
            恢复默认
          </button>
          <div style={{ flex: 1 }} />
          <button className="settings-btn" onClick={handleCancel}>
            取消
          </button>
          <button className="settings-btn primary" onClick={handleApply}>
            应用
          </button>
        </footer>
      </aside>
    </div>
  );
}
