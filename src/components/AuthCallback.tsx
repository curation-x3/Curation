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
type CallbackResult = { idToken: string } | { error: string };
let _callbackPromise: Promise<CallbackResult> | null = null;

function getCallbackResult(): Promise<CallbackResult> {
  if (!_callbackPromise) {
    const timeout = new Promise<CallbackResult>(resolve =>
      setTimeout(() => resolve({ error: `Token exchange timed out (15s). Origin: ${window.location.origin} URL: ${window.location.href}` }), 15000)
    );
    const exchange = authingClient
      .handleRedirectCallback()
      .then((res: any) => {
        const idToken = res?.idToken ?? "";
        if (!idToken) return { error: `No ID token returned. Response: ${JSON.stringify(res)}` };
        return { idToken };
      })
      .catch((e: any) => ({ error: `${e?.message ?? "Auth error"} (${e?.code ?? ""})` }));
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
  const [pendingToken, setPendingToken] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    async function handle() {
      const result = await getCallbackResult();

      if ("error" in result) {
        setError(result.error);
        setStep("error");
        return;
      }

      const { idToken } = result;

      try {
        const resp = await apiFetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_token: idToken }),
        });
        const data = await resp.json();

        if (resp.ok) {
          login(idToken, {
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
          // New user — need activation
          setPendingToken(idToken);
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
        body: JSON.stringify({ id_token: pendingToken, invite_token: vData.validation_token }),
      });
      const rData = await rResp.json();
      if (!rResp.ok) {
        setError(rData.detail || "激活失败");
        return;
      }

      login(pendingToken, {
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
    background: "#0d1117",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };

  if (step === "loading") {
    return (
      <div style={{ ...container, color: "#8b949e", fontSize: 14 }}>
        正在完成登录…
      </div>
    );
  }

  if (step === "error") {
    return (
      <div style={{ ...container, flexDirection: "column", gap: 16 }}>
        <p style={{ color: "#f85149", fontSize: 14, margin: 0 }}>{error}</p>
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
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 12,
        padding: "40px 48px",
        width: 360,
        color: "#e6edf3",
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 6px", textAlign: "center" }}>
          Curation
        </h1>
        <p style={{ fontSize: 13, color: "#3fb950", margin: "0 0 24px", textAlign: "center" }}>
          ✓ 身份验证完成
        </p>

        {error && (
          <div style={{
            background: "#3d1a1a", border: "1px solid #6e3535",
            borderRadius: 6, padding: "8px 12px",
            fontSize: 13, color: "#f85149", marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <p style={{ fontSize: 13, color: "#8b949e", marginBottom: 8 }}>
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
  background: "#238636", border: "none", borderRadius: 6,
  color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer", marginTop: 8,
};

const ghostBtn: React.CSSProperties = {
  width: "100%", padding: "8px 0",
  background: "none", border: "1px solid #30363d", borderRadius: 6,
  color: "#8b949e", fontSize: 13, cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px",
  background: "#0d1117", border: "1px solid #30363d", borderRadius: 6,
  color: "#e6edf3", fontSize: 14, outline: "none",
  marginBottom: 8, boxSizing: "border-box",
};
