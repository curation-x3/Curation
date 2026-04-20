export type FontBody = "serif" | "sans" | "mono";

export interface AppearanceSettings {
  /** null = auto (viewport-driven). System chrome (sidebar/list/UI) root font-size. */
  rootSizeOverride: number | null;
  /** Reader pane font size in px. Drives --reader-font-size. */
  readerSize: number;
  /** Reader content max-width in px. Drives --reader-max-width. */
  readerMaxWidth: number;
  /** Reader body font family. */
  fontBody: FontBody;
}

export const ROOT_SIZE_MIN = 10;
export const ROOT_SIZE_MAX = 22;

export const READER_SIZE_MIN = 13;
export const READER_SIZE_MAX = 24;
export const READER_SIZE_DEFAULT = 16;

export const READER_WIDTH_MIN = 560;
export const READER_WIDTH_MAX = 1200;
export const READER_WIDTH_DEFAULT = 800;
export const READER_WIDTH_STEP = 40;

const STORAGE_KEY = "appearance";

export const DEFAULTS: AppearanceSettings = {
  rootSizeOverride: null,
  readerSize: READER_SIZE_DEFAULT,
  readerMaxWidth: READER_WIDTH_DEFAULT,
  fontBody: "serif",
};

export function autoRootSize(viewportWidth: number): number {
  if (viewportWidth < 1280) return 13;
  if (viewportWidth < 1680) return 14;
  if (viewportWidth < 2400) return 15;
  return 16;
}

export function clampRootSize(n: number): number {
  return Math.min(ROOT_SIZE_MAX, Math.max(ROOT_SIZE_MIN, Math.round(n)));
}

export function clampReaderSize(n: number): number {
  return Math.min(READER_SIZE_MAX, Math.max(READER_SIZE_MIN, Math.round(n)));
}

export function clampReaderWidth(n: number): number {
  const rounded = Math.round(n / READER_WIDTH_STEP) * READER_WIDTH_STEP;
  return Math.min(READER_WIDTH_MAX, Math.max(READER_WIDTH_MIN, rounded));
}

const BODY_FAMILY: Record<FontBody, string> = {
  serif: `"Charter", "Bitstream Charter", "Georgia", "Noto Serif SC", serif`,
  sans: `-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif`,
  mono: `"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`,
};

export function apply(settings: AppearanceSettings, viewportWidth: number): void {
  const root = document.documentElement;
  const rootSize =
    settings.rootSizeOverride !== null
      ? clampRootSize(settings.rootSizeOverride)
      : autoRootSize(viewportWidth);
  root.style.setProperty("--root-size", `${rootSize}px`);
  root.style.setProperty("--font-body", BODY_FAMILY[settings.fontBody]);
  root.style.setProperty("--reader-font-size", `${clampReaderSize(settings.readerSize)}px`);
  root.style.setProperty("--reader-max-width", `${clampReaderWidth(settings.readerMaxWidth)}px`);
  root.removeAttribute("data-density");
}

export function load(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
    return {
      rootSizeOverride:
        typeof parsed.rootSizeOverride === "number"
          ? clampRootSize(parsed.rootSizeOverride)
          : null,
      readerSize:
        typeof parsed.readerSize === "number"
          ? clampReaderSize(parsed.readerSize)
          : READER_SIZE_DEFAULT,
      readerMaxWidth:
        typeof parsed.readerMaxWidth === "number"
          ? clampReaderWidth(parsed.readerMaxWidth)
          : READER_WIDTH_DEFAULT,
      fontBody:
        parsed.fontBody === "sans" || parsed.fontBody === "mono"
          ? parsed.fontBody
          : "serif",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(settings: AppearanceSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
