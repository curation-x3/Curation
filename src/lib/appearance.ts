export type FontBody = "serif" | "sans" | "mono";
export type Density = "compact" | "normal" | "relaxed";

export interface AppearanceSettings {
  rootSizeOverride: number | null; // null = auto
  fontBody: FontBody;
  density: Density;
}

export const ROOT_SIZE_MIN = 10;
export const ROOT_SIZE_MAX = 22;
const STORAGE_KEY = "appearance";

export const DEFAULTS: AppearanceSettings = {
  rootSizeOverride: null,
  fontBody: "serif",
  density: "normal",
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

const BODY_FAMILY: Record<FontBody, string> = {
  serif: `"Charter", "Bitstream Charter", "Georgia", "Noto Serif SC", serif`,
  sans: `-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif`,
  mono: `"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`,
};

export function apply(settings: AppearanceSettings, viewportWidth: number): void {
  const root = document.documentElement;
  const size =
    settings.rootSizeOverride !== null
      ? clampRootSize(settings.rootSizeOverride)
      : autoRootSize(viewportWidth);
  root.style.setProperty("--root-size", `${size}px`);
  root.style.setProperty("--font-body", BODY_FAMILY[settings.fontBody]);
  root.setAttribute("data-density", settings.density);
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
      fontBody:
        parsed.fontBody === "sans" || parsed.fontBody === "mono"
          ? parsed.fontBody
          : "serif",
      density:
        parsed.density === "compact" || parsed.density === "relaxed"
          ? parsed.density
          : "normal",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(settings: AppearanceSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
