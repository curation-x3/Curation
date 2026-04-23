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

import { refreshAccessToken } from "./refreshAuth";

export const API_BASE = computeApiBase();
export const WS_BASE = computeWsBase();

export function getApiBase(): string {
  return API_BASE;
}

export function getWsBase(): string {
  return WS_BASE;
}

let _token: string | null = null;
let _refreshToken: string | null = null;

export function setAuthToken(token: string | null) {
  _token = token;
}

export function getAuthToken(): string | null {
  return _token;
}

export function setRefreshToken(token: string | null) {
  _refreshToken = token;
}

export function getRefreshToken(): string | null {
  return _refreshToken;
}

async function sendWithToken(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (_token) {
    headers.set("Authorization", `Bearer ${_token}`);
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let resp = await sendWithToken(path, init);
  if (resp.status !== 401) return resp;

  // Try refresh once.
  const fresh = await refreshAccessToken();
  if (!fresh) {
    // refreshAccessToken already dispatched auth:expired and cleared storage.
    return resp;
  }
  _token = fresh;
  return sendWithToken(path, init);
}

export async function fetchCacheSecret(): Promise<string> {
  const r = await apiFetch("/auth/cache-secret");
  if (!r.ok) throw new Error(`cache-secret failed: ${r.status}`);
  const j = await r.json();
  return j.secret;
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

export async function fetchArticleCards(articleId: string) {
  const resp = await apiFetch(`/articles/${articleId}/cards`);
  return resp.json();
}

export async function fetchCardContent(cardId: string) {
  const resp = await apiFetch(`/cards/${cardId}/content`);
  return resp.json();
}

export async function fetchCardsByDate(date: string) {
  const resp = await apiFetch(`/cards?date=${date}`);
  return resp.json();
}

export async function fetchAggregatedCards(date: string) {
  const resp = await apiFetch(`/aggregated-cards?date=${date}`);
  return resp.json();
}

export async function fetchAggregatedCardContent(cardId: string) {
  const resp = await apiFetch(`/aggregated-cards/${cardId}/content`);
  return resp.json();
}

export async function triggerAggregation(date: string) {
  const resp = await apiFetch(`/aggregate?date=${date}`, { method: "POST" });
  return resp.json();
}

export async function fetchDiscarded() {
  const resp = await apiFetch("/discarded");
  return resp.json();
}

export async function fetchQueue() {
  const res = await apiFetch("/queue");
  const json = await res.json();
  return json.data;
}

export async function fetchStrategy() {
  const res = await apiFetch("/strategy");
  const json = await res.json();
  return json.data;
}

export async function patchStrategy(body: Record<string, unknown>) {
  const res = await apiFetch("/strategy", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function fetchBackends() {
  const res = await apiFetch("/agent/backends");
  const json = await res.json();
  return json.data;
}

export async function triggerQueueRun(articleId: string) {
  const res = await apiFetch(`/queue/${articleId}/run`, { method: "POST" });
  return res.json();
}

export async function retryQueueEntry(articleId: string) {
  const res = await apiFetch(`/queue/${articleId}/retry`, { method: "POST" });
  return res.json();
}

export async function dismissQueueEntry(articleId: string) {
  const res = await apiFetch(`/queue/${articleId}`, { method: "DELETE" });
  return res.json();
}


export async function fetchArticleRuns(articleId: string) {
  const res = await apiFetch(`/articles/${articleId}/runs`);
  const json = await res.json();
  return json.data;
}

export async function fetchRun(runId: number) {
  const res = await apiFetch(`/runs/${runId}`);
  const json = await res.json();
  return json.data;
}

export async function deleteRun(runId: number) {
  const res = await apiFetch(`/runs/${runId}`, { method: "DELETE" });
  return res.json();
}

export async function setServingRun(articleId: string, runId: number) {
  const res = await apiFetch(`/articles/${articleId}/serving-run`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_id: runId }),
  });
  return res.json();
}

export async function fetchRunStream(runId: number, offset = 0, limit = 500) {
  const res = await apiFetch(`/runs/${runId}/stream?offset=${offset}&limit=${limit}`);
  const json = await res.json();
  return json;
}

export async function fetchRunFiles(runId: number) {
  const res = await apiFetch(`/runs/${runId}/files`);
  const json = await res.json();
  return json.data;
}

export async function fetchRunFile(runId: number, filepath: string) {
  const res = await apiFetch(`/runs/${runId}/files/${filepath}`);
  const json = await res.json();
  return json.content;
}

// ==================== Feedback ====================

export interface AnnotationRow {
  id: number;
  card_id: string;
  article_id: string;
  run_id: string | null;
  label: string;
  note: string | null;
  admin_username: string;
  created_at: string | null;
}

export interface AdminCardRow {
  card_id: string;
  article_id: string;
  title: string;
  description: string | null;
  routing: string | null;
  article_date: string | null;
  annotation_count: number;
  upvote_count: number;
  downvote_count: number;
}

export async function fetchVotes(cardIds: string[]): Promise<Record<string, 1 | -1>> {
  if (cardIds.length === 0) return {};
  const resp = await apiFetch(`/feedback/vote?card_ids=${cardIds.join(",")}`);
  if (!resp.ok) throw new Error(`fetchVotes ${resp.status}`);
  const body = await resp.json();
  return body.votes ?? {};
}

export async function putVote(cardId: string, vote: 1 | -1): Promise<{ card_id: string; vote: 1 | -1 | null }> {
  const resp = await apiFetch(`/feedback/vote`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card_id: cardId, vote }),
  });
  if (!resp.ok) throw new Error(`putVote ${resp.status}`);
  return resp.json();
}

export async function deleteVote(cardId: string): Promise<void> {
  const resp = await apiFetch(`/feedback/vote/${encodeURIComponent(cardId)}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`deleteVote ${resp.status}`);
}

export async function fetchAnnotationsSingle(cardId: string): Promise<AnnotationRow[]> {
  const resp = await apiFetch(`/feedback/annotations?card_id=${encodeURIComponent(cardId)}`);
  if (!resp.ok) throw new Error(`fetchAnnotationsSingle ${resp.status}`);
  const body = await resp.json();
  return body.annotations ?? [];
}

export async function fetchAnnotationsBatch(cardIds: string[]): Promise<Record<string, AnnotationRow[]>> {
  if (cardIds.length === 0) return {};
  const resp = await apiFetch(`/feedback/annotations?card_ids=${cardIds.join(",")}`);
  if (!resp.ok) throw new Error(`fetchAnnotationsBatch ${resp.status}`);
  const body = await resp.json();
  return body.annotations ?? {};
}

export async function addAnnotation(cardId: string, label: string, note?: string): Promise<AnnotationRow> {
  const resp = await apiFetch(`/feedback/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card_id: cardId, label, note }),
  });
  if (!resp.ok) throw new Error(`addAnnotation ${resp.status}`);
  return resp.json();
}

export async function deleteAnnotation(annotationId: number): Promise<void> {
  const resp = await apiFetch(`/feedback/annotations/${annotationId}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`deleteAnnotation ${resp.status}`);
}

export async function fetchAdminCards(params: {
  has_annotation?: boolean;
  has_downvote?: boolean;
  routing?: string;
  order?: "recent" | "downvotes" | "annotations";
  limit?: number;
  offset?: number;
}): Promise<AdminCardRow[]> {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) usp.set(k, String(v));
  }
  const resp = await apiFetch(`/feedback/admin/cards?${usp.toString()}`);
  if (!resp.ok) throw new Error(`fetchAdminCards ${resp.status}`);
  const body = await resp.json();
  return body.cards ?? [];
}

