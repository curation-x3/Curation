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

const FONT_LABELS: Record<FontBody, string> = {
  serif: "衬线",
  sans: "无衬线",
  mono: "等宽",
};

const DENSITY_LABELS: Record<Density, string> = {
  compact: "紧凑",
  normal: "标准",
  relaxed: "宽松",
};

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
      <aside className="settings-drawer-panel" onClick={(e) => e.stopPropagation()}>
        <header className="settings-drawer-header">
          <h3>外观设置</h3>
          <button className="btn-icon" onClick={handleCancel} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="settings-drawer-body">
          <section className="settings-section">
            <h4>字号 {isAuto && <span className="settings-auto-tag">自动</span>}</h4>
            <div className="settings-slider-row">
              <input
                type="range"
                min={ROOT_SIZE_MIN}
                max={ROOT_SIZE_MAX}
                step={1}
                value={currentSize}
                onChange={(e) =>
                  onChange({ rootSizeOverride: Number(e.target.value) })
                }
              />
              <span className="settings-slider-value">{currentSize}px</span>
            </div>
            <div className="settings-section-footer">
              <span className="settings-hint">自动档位: {autoSize}px（按视口宽度）</span>
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

          <section className="settings-section">
            <h4>正文字体</h4>
            <div className="settings-segmented">
              {(Object.keys(FONT_LABELS) as FontBody[]).map((f) => (
                <button
                  key={f}
                  className={`settings-seg-btn ${draft.fontBody === f ? "active" : ""}`}
                  onClick={() => onChange({ fontBody: f })}
                >
                  {FONT_LABELS[f]}
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <h4>阅读密度</h4>
            <div className="settings-segmented">
              {(Object.keys(DENSITY_LABELS) as Density[]).map((d) => (
                <button
                  key={d}
                  className={`settings-seg-btn ${draft.density === d ? "active" : ""}`}
                  onClick={() => onChange({ density: d })}
                >
                  {DENSITY_LABELS[d]}
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <h4>预览</h4>
            <div className="settings-preview">
              <div className="settings-preview-title">文章标题示例</div>
              <div className="settings-preview-meta">公众号名称 · 2026-04-20</div>
              <p className="settings-preview-body">
                这是一段正文预览文本，用于展示当前字号、字体族和阅读密度下的实际阅读效果。
                调整设置可以立即看到变化。
              </p>
            </div>
          </section>
        </div>

        <footer className="settings-drawer-footer">
          <button className="settings-link-btn" onClick={onReset}>
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
