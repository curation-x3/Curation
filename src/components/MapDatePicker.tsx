// Atlas date picker — a navigator's almanac page.
// Replaces the native <input type="date"> with a vellum-cartouche calendar.

import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  /** Selected date, ISO YYYY-MM-DD or null. */
  value: string | null;
  onChange: (iso: string) => void;
  /** Earliest selectable date (inclusive), ISO. */
  min?: string;
  /** Latest selectable date (inclusive), ISO. */
  max?: string;
  onClose: () => void;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromIso(s: string): Date {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
}

export function MapDatePicker({ value, onChange, min, max, onClose }: Props) {
  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => toIso(today), [today]);
  const initial = value ? fromIso(value) : max ? fromIso(max) : today;
  const [viewMonth, setViewMonth] = useState<Date>(
    new Date(initial.getFullYear(), initial.getMonth(), 1),
  );
  const popoverRef = useRef<HTMLDivElement>(null);

  // ESC + click-outside
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    // Defer click-outside listener one tick so the opening click doesn't close us.
    const t = window.setTimeout(
      () => document.addEventListener("mousedown", onClick, true),
      0,
    );
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick, true);
    };
  }, [onClose]);

  const days = useMemo(() => {
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewMonth]);

  const minD = min ? fromIso(min) : null;
  const maxD = max ? fromIso(max) : null;
  const cellState = (d: Date): "selected" | "today" | "disabled" | "" => {
    const iso = toIso(d);
    if (value && iso === value) return "selected";
    if ((minD && d < minD) || (maxD && d > maxD)) return "disabled";
    if (iso === todayIso) return "today";
    return "";
  };

  const monthName = `${viewMonth.getMonth() + 1}月`;
  const yearLabel = `${viewMonth.getFullYear()}年`;

  const prev = () =>
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1));
  const next = () =>
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));

  return (
    <div
      ref={popoverRef}
      className="map-datepicker"
      role="dialog"
      aria-label="选择历史日期"
    >
      <header className="adp-header">
        <button
          type="button"
          className="adp-nav"
          onClick={prev}
          aria-label="上一月"
        >
          ‹
        </button>
        <div className="adp-title">
          <div className="adp-month">{monthName}</div>
          <div className="adp-year">{yearLabel}</div>
        </div>
        <button
          type="button"
          className="adp-nav"
          onClick={next}
          aria-label="下一月"
        >
          ›
        </button>
      </header>

      <div className="adp-weekdays">
        {WEEKDAYS.map((w, i) => (
          <span
            key={w}
            className={`adp-weekday ${i === 0 || i === 6 ? "weekend" : ""}`}
          >
            {w}
          </span>
        ))}
      </div>

      <div className="adp-grid">
        {days.map((d, i) => {
          if (!d) return <span key={`pad-${i}`} className="adp-cell pad" />;
          const state = cellState(d);
          const cls = `adp-cell ${state}`.trim();
          const disabled = state === "disabled";
          return (
            <button
              type="button"
              key={toIso(d)}
              className={cls}
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                onChange(toIso(d));
                onClose();
              }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <footer className="adp-footer">
        <span className="adp-footer-text">选择历史日期</span>
      </footer>
    </div>
  );
}
