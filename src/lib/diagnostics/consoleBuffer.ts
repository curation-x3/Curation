export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleEntry {
  ts: string;
  level: ConsoleLevel;
  message: string;
  values: string[];
}

export interface ConsoleBufferOptions {
  limit?: number;
  now?: () => string;
}

export function serializeConsoleValue(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") return value;
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "undefined"
  ) {
    return String(value);
  }

  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "bigint") return nested.toString();
      if (nested instanceof Error) return nested.stack || `${nested.name}: ${nested.message}`;
      if (nested && typeof nested === "object") {
        if (seen.has(nested)) return "[Circular]";
        seen.add(nested);
      }
      return nested;
    });
  } catch {
    return String(value);
  }
}

export function createConsoleBuffer(options: ConsoleBufferOptions = {}) {
  const limit = Math.max(1, options.limit ?? 2000);
  const now = options.now ?? (() => new Date().toISOString());
  const entries: ConsoleEntry[] = [];

  const api = {
    push(level: ConsoleLevel, values: unknown[]) {
      const serialized = values.map(serializeConsoleValue);
      entries.push({
        ts: now(),
        level,
        message: serialized.join(" "),
        values: serialized,
      });
      if (entries.length > limit) {
        entries.splice(0, entries.length - limit);
      }
    },
    entries() {
      return entries.slice();
    },
    toText() {
      return entries.map((entry) => `[${entry.ts}] [${entry.level}] ${entry.message}`).join("\n");
    },
    toJson() {
      return JSON.stringify(entries, null, 2);
    },
  };

  return api;
}
