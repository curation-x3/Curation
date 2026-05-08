import { createConsoleBuffer, type ConsoleLevel } from "./consoleBuffer";

const globalKey = "__curationConsoleDiagnostics";

type ConsoleBuffer = ReturnType<typeof createConsoleBuffer>;

declare global {
  interface Window {
    __curationConsoleDiagnostics?: ConsoleBuffer;
  }
}

function installConsoleCapture(): ConsoleBuffer {
  if (typeof window === "undefined") {
    return createConsoleBuffer();
  }
  if (window.__curationConsoleDiagnostics) {
    return window.__curationConsoleDiagnostics;
  }

  const existing = (window as any)[globalKey] as ConsoleBuffer | undefined;
  const buffer = existing || createConsoleBuffer({ limit: 2500 });
  (window as any)[globalKey] = buffer;
  window.__curationConsoleDiagnostics = buffer;

  (["log", "info", "warn", "error", "debug"] as ConsoleLevel[]).forEach((level) => {
    const original = console[level]?.bind(console);
    if (!original) return;
    console[level] = (...values: unknown[]) => {
      buffer.push(level, values);
      original(...values);
    };
  });

  window.addEventListener("error", (event) => {
    buffer.push("error", [
      "window.error",
      event.message,
      event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "",
      event.error,
    ]);
  });

  window.addEventListener("unhandledrejection", (event) => {
    buffer.push("error", ["window.unhandledrejection", event.reason]);
  });

  return buffer;
}

export const consoleDiagnostics = installConsoleCapture();

export function getConsoleDiagnosticsPayload() {
  return {
    text: consoleDiagnostics.toText(),
    json: consoleDiagnostics.toJson(),
  };
}
