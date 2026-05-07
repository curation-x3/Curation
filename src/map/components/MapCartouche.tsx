// Atlas — title cartouche (top-left decorative title block).

import { useMemo, useState } from "react";
import { MapDatePicker } from "../../components/MapDatePicker";
import type { DateTab } from "../../components/MapTabBar";

type Props = {
  date: string;
  tab: DateTab;
  onTabChange: (next: DateTab) => void;
  earliest?: string;
};

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tabForDate(iso: string): DateTab {
  const yesterday = isoDaysAgo(1);
  const dayBefore = isoDaysAgo(2);
  if (iso === yesterday) return { kind: "yesterday" };
  if (iso === dayBefore) return { kind: "day_before" };
  return { kind: "earlier", date: iso };
}

function formatChineseDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}年${m}月${d}日`;
}

export function MapCartouche({ date, tab, onTabChange, earliest }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerMax = useMemo(() => isoDaysAgo(1), []);
  const canGoNext = date < pickerMax;
  const canGoPrev = !earliest || date > earliest;

  const changeDate = (iso: string) => onTabChange(tabForDate(iso));

  return (
    <div
      style={{
        position: "absolute",
        top: 28,
        left: 28,
        border: "2px double var(--map-ink)",
        padding: "var(--map-cartouche-pad)",
        background: "var(--map-vellum)",
        boxShadow: "var(--map-shadow-vellum)",
        zIndex: 5,
        pointerEvents: "auto",
        minWidth: 438,
      }}
    >
      <div
        style={{
          fontFamily: "var(--map-mono)",
          fontSize: 10,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: "var(--map-ink-2)",
        }}
      >
        CURATION · 今日舆图
      </div>
      <h1
        style={{
          fontFamily: "var(--map-display)",
          fontWeight: 400,
          fontSize: 28,
          letterSpacing: "0.04em",
          margin: "4px 0 0",
        }}
      >
        今日舆图{" "}
        <span style={{ fontStyle: "italic", color: "var(--map-rust)" }}>·</span>{" "}
        <span
          style={{
            fontStyle: "italic",
            fontFamily: "var(--map-serif)",
            color: "var(--map-rust)",
          }}
        >
          {formatChineseDate(date)}
        </span>
      </h1>
      <div
        style={{
          fontFamily: "var(--map-serif)",
          fontStyle: "italic",
          fontSize: 13,
          color: "var(--map-ink-2)",
          marginTop: 4,
        }}
      >
        记录这一天读过的信息岛屿。
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 12,
          paddingTop: 10,
          borderTop: "1px solid var(--map-ink-2)",
          fontFamily: "var(--map-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
        }}
      >
        <button
          type="button"
          className="map-cartouche-date-button"
          disabled={!canGoPrev}
          onClick={() => changeDate(addDays(date, -1))}
        >
          前一日
        </button>
        <span className="map-cartouche-date-picker-anchor">
          <button
            type="button"
            className="map-cartouche-date-button primary"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((o) => !o)}
          >
            选择日期
          </button>
          {pickerOpen && (
            <MapDatePicker
              value={tab.kind === "earlier" ? tab.date : date}
              onChange={changeDate}
              min={earliest}
              max={pickerMax}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </span>
        <button
          type="button"
          className="map-cartouche-date-button"
          disabled={!canGoNext}
          onClick={() => changeDate(addDays(date, 1))}
        >
          后一日
        </button>
      </div>
    </div>
  );
}
