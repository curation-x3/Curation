import { X } from "lucide-react";
import type { AppearanceSettings, Density, FontBody } from "../lib/appearance";
import { ROOT_SIZE_MAX, ROOT_SIZE_MIN } from "../lib/appearance";

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

const DENSITY_OPTIONS: { key: Density; label: string; bars: number[] }[] = [
  { key: "compact", label: "紧凑", bars: [2, 2, 2] },
  { key: "normal", label: "标准", bars: [3, 3, 3] },
  { key: "relaxed", label: "宽松", bars: [4, 4, 4] },
];

function DensityGlyph({ bars }: { bars: number[] }) {
  return (
    <span className="settings-density-glyph" aria-hidden>
      {bars.map((h, i) => (
        <span
          key={i}
          className="settings-density-bar"
          style={{ width: 14, height: 1, marginTop: h + 1, marginBottom: h + 1 }}
        />
      ))}
    </span>
  );
}

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

  const currentSize = draft.rootSizeOverride ?? autoSize;
  const isAuto = draft.rootSizeOverride === null;
  const sliderPct =
    ((currentSize - ROOT_SIZE_MIN) / (ROOT_SIZE_MAX - ROOT_SIZE_MIN)) * 100;

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
              <span>字号</span>
              {isAuto && <span className="settings-auto-tag">AUTO</span>}
            </h4>
            <div className="settings-slider-row">
              <span className="settings-slider-edge">A</span>
              <input
                type="range"
                min={ROOT_SIZE_MIN}
                max={ROOT_SIZE_MAX}
                step={1}
                value={currentSize}
                onChange={(e) =>
                  onChange({ rootSizeOverride: Number(e.target.value) })
                }
                aria-label="根字号"
                style={{ ["--slider-fill" as any]: `${sliderPct}%` }}
              />
              <span
                className="settings-slider-edge"
                style={{ fontSize: "1.1rem" }}
              >
                A
              </span>
              <span className="settings-slider-value">{currentSize}px</span>
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

          <section className="settings-section settings-section-stagger-2">
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

          <section className="settings-section settings-section-stagger-3">
            <h4>
              <span>阅读密度</span>
            </h4>
            <div className="settings-segmented">
              {DENSITY_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  className={`settings-seg-btn ${
                    draft.density === opt.key ? "active" : ""
                  }`}
                  onClick={() => onChange({ density: opt.key })}
                >
                  <DensityGlyph bars={opt.bars} />
                  <span className="settings-seg-label">{opt.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section settings-section-stagger-4">
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
              <p className="settings-preview-body">
                这是一段用于展示当前<strong>字号、字体族与阅读密度</strong>的正文样例。
                调整左侧任一设置，这段文字会立刻随之改变——行距、字面、节奏。
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
