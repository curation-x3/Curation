const API_BASE = "http://127.0.0.1:8889";

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
