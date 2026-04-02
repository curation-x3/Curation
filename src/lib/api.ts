function computeApiBase(): string {
  const v = import.meta.env.VITE_API_BASE;
  if (v && typeof v === "string" && v.length > 0) {
    return v.replace(/\/$/, "");
  }
  return "http://127.0.0.1:8889";
}

function computeWsBase(): string {
  const w = import.meta.env.VITE_WS_BASE;
  if (w && typeof w === "string" && w.length > 0) {
    return w.replace(/\/$/, "");
  }
  const api = computeApiBase();
  if (api.startsWith("https://")) {
    return "wss://" + api.slice("https://".length);
  }
  if (api.startsWith("http://")) {
    return "ws://" + api.slice("http://".length);
  }
  return "ws://127.0.0.1:8889";
}

export const API_BASE = computeApiBase();
export const WS_BASE = computeWsBase();

export function getApiBase(): string {
  return API_BASE;
}

export function getWsBase(): string {
  return WS_BASE;
}

let _token: string | null = null;

export function setAuthToken(token: string | null) {
  _token = token;
}

export function getAuthToken(): string | null {
  return _token;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (_token) {
    headers.set("Authorization", `Bearer ${_token}`);
  }
  const resp = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (resp.status === 401) {
    setAuthToken(null);
    window.dispatchEvent(new Event("auth:expired"));
  }
  return resp;
}

/** Absolute URL for GET /static/... with HMAC (for img src without Bearer). */
export async function fetchSignedStaticUrl(relpath: string): Promise<string> {
  const r = await apiFetch(`/auth/static-link?relpath=${encodeURIComponent(relpath)}`);
  if (!r.ok) {
    throw new Error(`static-link failed: ${r.status}`);
  }
  const j = (await r.json()) as { url: string };
  return `${API_BASE}${j.url}`;
}
