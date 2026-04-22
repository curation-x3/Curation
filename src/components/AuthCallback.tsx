import React, { useEffect, useRef, useState } from "react";
import { authingClient } from "../lib/authing";
import { useAuth } from "../lib/authStore";
import { apiFetch } from "../lib/api";
import type { AppUser } from "../lib/authStore";

interface AuthCallbackProps {
  onDone: () => void;
}

// Module-level Promise singleton — handleRedirectCallback() is called exactly once
// regardless of how many times the component mounts (StrictMode, HMR, etc.).
// Call resetCallback() before starting a new loginWithRedirect flow.
type CallbackResult =
  | {
      accessToken: string;
      idToken: string;
      refreshToken: string;
      rawKeys: string[];
      rawScope?: string;
    }
  | { error: string; missing?: "access_token" | "id_token" | "refresh_token"; rawKeys?: string[]; rawScope?: string };

let _callbackPromise: Promise<CallbackResult> | null = null;

const FORCED_RETRY_KEY = "__auth_forced_retry";

function getCallbackResult(): Promise<CallbackResult> {
  if (!_callbackPromise) {
    const timeout = new Promise<CallbackResult>(resolve =>
      setTimeout(() => resolve({ error: `Token exchange timed out (15s). Origin: ${window.location.origin} URL: ${window.location.href}` }), 15000)
    );
    const exchange = authingClient
      .handleRedirectCallback()
      .then((res: any) => {
        const rawKeys = Object.keys(res || {});
        const rawScope: string | undefined = res?.scope;
        const accessToken: string = res?.accessToken ?? "";
        const idToken: string = res?.idToken ?? "";
        const refreshToken: string = res?.refreshToken ?? "";
        console.log("[auth] handleRedirectCallback returned", {
          keys: rawKeys,
          accessToken_len: accessToken.length,
          idToken_len: idToken.length,
          refreshToken_len: refreshToken.length,
          scope: rawScope ?? "(missing)",
          url_had_code: window.location.search.includes("code="),
        });
        if (!accessToken) return { error: `No access_token returned. Response keys: ${rawKeys.join(",")}`, missing: "access_token" as const, rawKeys, rawScope };
        if (!idToken) return { error: `No id_token returned. Response keys: ${rawKeys.join(",")}`, missing: "id_token" as const, rawKeys, rawScope };
        if (!refreshToken) return { error: `No refresh_token returned. Keys: ${rawKeys.join(",")}, scope: ${rawScope ?? "(missing)"}`, missing: "refresh_token" as const, rawKeys, rawScope };
        return { accessToken, idToken, refreshToken, rawKeys, rawScope };
      })
      .catch((e: any) => {
        console.error("[auth] handleRedirectCallback threw", {
          message: e?.message,
          code: e?.code,
          name: e?.name,
        });
        return { error: `${e?.message ?? "Auth error"} (${e?.code ?? ""})` };
      });
    _callbackPromise = Promise.race([exchange, timeout]);
  }
  return _callbackPromise;
}

export function resetCallback() {
  _callbackPromise = null;
}

export function AuthCallback({ onDone }: AuthCallbackProps) {
  const { login } = useAuth();
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  type Step = "loading" | "invite" | "error";
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState("");
  const [pendingTokens, setPendingTokens] = useState<{
    accessToken: string;
    idToken: string;
    refreshToken: string;
  }>({ accessToken: "", idToken: "", refreshToken: "" });
  const [inviteCode, setInviteCode] = useState("");
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    async function handle() {
      const result = await getCallbackResult();

      if ("error" in result) {
        // Auto-recovery: if refresh_token is missing (likely stale Authing SSO session
        // from before offline_access was requested), force a fresh consent once.
        // Guarded by localStorage flag to prevent infinite loop.
        if (result.missing === "refresh_token" && localStorage.getItem(FORCED_RETRY_KEY) !== "1") {
          console.warn("[auth] no refresh_token — forcing re-authentication to refresh Authing consent", {
            rawKeys: result.rawKeys,
            rawScope: result.rawScope,
          });
          localStorage.setItem(FORCED_RETRY_KEY, "1");
          resetCallback();
          // forced: true makes the SDK add prompt=login — forces Authing to re-authenticate
          // the user, which results in a fresh consent that includes offline_access.
          authingClient.loginWithRedirect({ forced: true } as any);
          return;
        }
        console.error("[auth] fatal", { error: result.error, missing: result.missing });
        setError(result.error);
        setStep("error");
        return;
      }

      // Success — clear the forced-retry flag if set.
      localStorage.removeItem(FORCED_RETRY_KEY);
      const { accessToken, idToken, refreshToken } = result;
      console.log("[auth] tokens captured OK", {
        accessToken_len: accessToken.length,
        refreshToken_len: refreshToken.length,
      });

      try {
        const resp = await apiFetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_token: idToken }),
        });
        const data = await resp.json();

        if (resp.ok) {
          // Store accessToken + refreshToken; idToken is discarded (not persisted).
          login(accessToken, refreshToken, {
            id: data.user_id,
            email: data.email || "",
            username: data.username || "",
            role: data.role,
          } as AppUser);
          window.history.replaceState({}, "", "/");
          onDoneRef.current();
          return;
        }

        if (resp.status === 401) {
          // New user — need activation. Hold all three until register call completes.
          setPendingTokens({ accessToken, idToken, refreshToken });
          setStep("invite");
        } else {
          setError(data.detail || "登录失败");
          setStep("error");
        }
      } catch (e: any) {
        setError(e?.message || "认证过程发生错误");
        setStep("error");
      }
    }

    handle();
  }, [login]);

  async function handleActivate() {
    if (!inviteCode.trim()) return;
    setActivating(true);
    setError("");
    try {
      const vResp = await apiFetch("/auth/validate-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: inviteCode.trim() }),
      });
      const vData = await vResp.json();
      if (!vResp.ok) {
        setError(vData.detail || "邀请码无效");
        return;
      }

      const rResp = await apiFetch("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_token: pendingTokens.idToken,
          invite_token: vData.validation_token,
        }),
      });
      const rData = await rResp.json();
      if (!rResp.ok) {
        setError(rData.detail || "激活失败");
        return;
      }

      // Store accessToken + refreshToken; idToken is discarded.
      login(pendingTokens.accessToken, pendingTokens.refreshToken, {
        id: rData.user_id,
        email: rData.email || "",
        username: rData.username || "",
        role: rData.role,
      } as AppUser);
      window.history.replaceState({}, "", "/");
      onDoneRef.current();
    } catch (e: any) {
      setError(e?.message || "发生错误，请重试");
    } finally {
      setActivating(false);
    }
  }

  const container: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg-base)",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };

  if (step === "loading") {
    return (
      <div style={{ ...container, color: "var(--text-muted)", fontSize: 14 }}>
        正在完成登录…
      </div>
    );
  }

  if (step === "error") {
    return (
      <div style={{ ...container, flexDirection: "column", gap: 16 }}>
        <p style={{ color: "var(--accent-red)", fontSize: 14, margin: 0 }}>{error}</p>
        <button
          onClick={() => { resetCallback(); authingClient.logoutWithRedirect({ redirectUri: window.location.origin }); }}
          style={ghostBtn}
        >
          返回登录
        </button>
      </div>
    );
  }

  // step === "invite"
  return (
    <div style={container}>
      <div style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "40px 48px",
        width: 360,
        color: "var(--text-primary)",
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 6px", textAlign: "center" }}>
          Curation
        </h1>
        <p style={{ fontSize: 13, color: "var(--accent-green)", margin: "0 0 24px", textAlign: "center" }}>
          ✓ 身份验证完成
        </p>

        {error && (
          <div style={{
            background: "rgba(201, 120, 112, 0.12)", border: "1px solid var(--accent-red)",
            borderRadius: 6, padding: "8px 12px",
            fontSize: 13, color: "var(--accent-red)", marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
          输入邀请码以激活账号：
        </p>
        <input
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleActivate()}
          placeholder="XXXX-XXXX-XXXX"
          autoFocus
          style={inputStyle}
        />
        <button
          onClick={handleActivate}
          disabled={activating || !inviteCode.trim()}
          style={primaryBtn}
        >
          {activating ? "激活中…" : "激活账号"}
        </button>
        <button
          onClick={() => { resetCallback(); authingClient.logoutWithRedirect({ redirectUri: window.location.origin }); }}
          style={{ ...ghostBtn, marginTop: 8 }}
        >
          重新登录
        </button>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  width: "100%", padding: "10px 0",
  background: "var(--accent-green)", border: "none", borderRadius: 6,
  color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer", marginTop: 8,
};

const ghostBtn: React.CSSProperties = {
  width: "100%", padding: "8px 0",
  background: "none", border: "1px solid var(--border)", borderRadius: 6,
  color: "var(--text-muted)", fontSize: 13, cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px",
  background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 6,
  color: "var(--text-primary)", fontSize: 14, outline: "none",
  marginBottom: 8, boxSizing: "border-box",
};
