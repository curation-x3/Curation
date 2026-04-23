// Hand-rolled OIDC Authorization Code + PKCE client for Authing.
// Replaces @authing/browser@0.0.1-alpha3 which drops refresh_token from
// the /oidc/token response (bug in its exchangeToken → saveLoginState path).

const DOMAIN = (import.meta.env.VITE_AUTHING_DOMAIN as string) || "https://curation.authing.cn";
const APP_ID = import.meta.env.VITE_AUTHING_APP_ID as string;
const REDIRECT_URI = import.meta.env.VITE_AUTHING_REDIRECT_URI as string;

export const AUTHING_SCOPE =
  "openid profile email phone offline_access username roles external_id extended_fields address";

const TX_KEY = "authing_tx"; // localStorage key for PKCE transaction state

interface Transaction {
  state: string;
  codeVerifier: string;
  nonce: string;
  createdAt: number;
}

console.log("[authing] config", {
  domain: DOMAIN,
  redirectUri: REDIRECT_URI,
  appId_preview: APP_ID ? `${APP_ID.slice(0, 6)}…(len=${APP_ID.length})` : null,
  scope: AUTHING_SCOPE,
});

if (!APP_ID || !DOMAIN || !REDIRECT_URI) {
  console.warn("[authing] missing VITE_AUTHING_APP_ID / DOMAIN / REDIRECT_URI");
}

// --- crypto utilities ---

function bytesToB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomB64Url(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return bytesToB64Url(bytes);
}

async function sha256B64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToB64Url(new Uint8Array(hash));
}

// --- flow ---

export interface LoginOptions {
  forced?: boolean;
}

async function loginWithRedirect(options: LoginOptions = {}): Promise<never> {
  const state = randomB64Url(24);
  const codeVerifier = randomB64Url(32);
  const nonce = randomB64Url(16);
  const codeChallenge = await sha256B64Url(codeVerifier);

  const tx: Transaction = { state, codeVerifier, nonce, createdAt: Date.now() };
  localStorage.setItem(TX_KEY, JSON.stringify(tx));

  const params = new URLSearchParams({
    response_type: "code",
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: AUTHING_SCOPE,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (options.forced) params.set("prompt", "login");

  const authUrl = `${DOMAIN}/oidc/auth?${params.toString()}`;
  console.log("[authing] loginWithRedirect →", { forced: !!options.forced });
  window.location.assign(authUrl);
  // Navigation is in-flight; return a never-resolving promise so callers don't continue.
  return new Promise<never>(() => {});
}

export interface CallbackTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

async function handleRedirectCallback(): Promise<CallbackTokens> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  if (error) {
    throw new Error(`Authing error=${error}${errorDesc ? ", " + errorDesc : ""}`);
  }
  if (!code || !state) {
    throw new Error("非法的回调 URL: 缺少 code 或 state");
  }

  const txRaw = localStorage.getItem(TX_KEY);
  if (!txRaw) {
    throw new Error("PKCE 会话丢失——请重新发起登录");
  }
  const tx: Transaction = JSON.parse(txRaw);
  localStorage.removeItem(TX_KEY);

  if (tx.state !== state) {
    throw new Error("state 验证失败");
  }

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: APP_ID,
    code_verifier: tx.codeVerifier,
  });
  console.log("[authing] POST /oidc/token (authorization_code)");
  const resp = await fetch(`${DOMAIN}/oidc/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  console.log("[authing] token response", {
    keys: Object.keys(data),
    access_token_len: data.access_token?.length ?? 0,
    id_token_len: data.id_token?.length ?? 0,
    refresh_token_len: data.refresh_token?.length ?? 0,
    scope: data.scope ?? "(missing)",
    expires_in: data.expires_in,
  });

  if (!data.access_token || !data.id_token) {
    throw new Error(`Token response missing required fields. Keys: ${Object.keys(data).join(",")}`);
  }
  if (!data.refresh_token) {
    throw new Error(
      `Token response missing refresh_token. Scope: ${data.scope ?? "(missing)"} — Authing app 需要启用 offline_access scope`,
    );
  }

  // Optional id_token nonce verification
  try {
    const idParts = data.id_token.split(".");
    if (idParts.length === 3) {
      const payload = JSON.parse(
        atob(idParts[1].replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (payload.nonce && payload.nonce !== tx.nonce) {
        throw new Error("nonce 验证失败");
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message === "nonce 验证失败") throw e;
    // Non-JSON payload: skip optional verification, id_token is still usable for backend
  }

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in ?? 0,
    scope: data.scope ?? "",
  };
}

export interface LogoutOptions {
  redirectUri?: string;
}

function logoutWithRedirect(options: LogoutOptions = {}): void {
  const params = new URLSearchParams({ client_id: APP_ID });
  if (options.redirectUri) params.set("post_logout_redirect_uri", options.redirectUri);
  const url = `${DOMAIN}/oidc/session/end?${params.toString()}`;
  console.log("[authing] logoutWithRedirect");
  window.location.assign(url);
}

function endSessionSilently(): void {
  const params = new URLSearchParams({ client_id: APP_ID });
  const url = `${DOMAIN}/oidc/session/end?${params.toString()}`;
  console.log("[authing] endSessionSilently");
  // Fire-and-forget: end the OIDC session without navigating the webview.
  // We don't care about the response — local state is already cleared.
  fetch(url, { mode: "no-cors" }).catch(() => {});
}

function resetTransaction(): void {
  localStorage.removeItem(TX_KEY);
}

function isRedirectCallback(): boolean {
  // A redirect-back URL has ?code=&state= (success) or ?error= (failure).
  // Be lenient: any of these markers in the current URL count.
  const q = window.location.search;
  return q.includes("code=") || q.includes("error=");
}

export const authingClient = {
  loginWithRedirect,
  handleRedirectCallback,
  logoutWithRedirect,
  endSessionSilently,
  resetTransaction,
  isRedirectCallback,
};
