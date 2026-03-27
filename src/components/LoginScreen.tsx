import React, { useState } from "react";
import { authingClient } from "../lib/authing";

const API_BASE = "http://127.0.0.1:8889";

export function LoginScreen() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [inviteCode, setInviteCode] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [validationToken, setValidationToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleValidateInvite() {
    if (!inviteCode.trim()) return;
    setError("");
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/auth/validate-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: inviteCode.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.detail || "邀请码无效");
        return;
      }
      setValidationToken(data.validation_token);
      setStep(2);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    const state = btoa(
      JSON.stringify({ invite_token: validationToken, action: "register" })
    );
    await authingClient.loginWithRedirect({ state });
  }

  async function handleLogin() {
    const state = btoa(JSON.stringify({ action: "login" }));
    await authingClient.loginWithRedirect({ state });
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0d1117",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 12,
          padding: "40px 48px",
          width: 380,
          color: "#e6edf3",
        }}
      >
        <h1
          style={{
            fontSize: 20,
            fontWeight: 600,
            margin: "0 0 8px",
            textAlign: "center",
          }}
        >
          Curation
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "#8b949e",
            margin: "0 0 28px",
            textAlign: "center",
          }}
        >
          你的专属资讯助理
        </p>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            marginBottom: 24,
            borderBottom: "1px solid #30363d",
          }}
        >
          {(["login", "register"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setStep(1);
                setError("");
                setInviteCode("");
              }}
              style={{
                flex: 1,
                padding: "8px 0",
                background: "none",
                border: "none",
                borderBottom:
                  tab === t ? "2px solid #58a6ff" : "2px solid transparent",
                color: tab === t ? "#e6edf3" : "#8b949e",
                cursor: "pointer",
                fontSize: 14,
                marginBottom: -1,
              }}
            >
              {t === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        {error && (
          <div
            style={{
              background: "#3d1a1a",
              border: "1px solid #6e3535",
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 13,
              color: "#f85149",
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {tab === "login" && (
          <button onClick={handleLogin} style={btnStyle("#238636", "#2ea043")}>
            使用 Authing 登录
          </button>
        )}

        {tab === "register" && step === 1 && (
          <>
            <label style={{ fontSize: 13, color: "#8b949e", display: "block", marginBottom: 6 }}>
              邀请码
            </label>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleValidateInvite()}
              placeholder="XXXX-XXXX-XXXX"
              style={inputStyle}
            />
            <button
              onClick={handleValidateInvite}
              disabled={loading || !inviteCode.trim()}
              style={btnStyle("#238636", "#2ea043")}
            >
              {loading ? "验证中…" : "验证邀请码"}
            </button>
          </>
        )}

        {tab === "register" && step === 2 && (
          <>
            <p style={{ fontSize: 13, color: "#3fb950", marginBottom: 16 }}>
              ✓ 邀请码有效，请前往 Authing 完成注册
            </p>
            <button onClick={handleRegister} style={btnStyle("#238636", "#2ea043")}>
              前往注册
            </button>
            <button
              onClick={() => { setStep(1); setError(""); }}
              style={{ ...btnStyle("#21262d", "#30363d"), marginTop: 8 }}
            >
              返回
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function btnStyle(bg: string, hoverBg: string): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 0",
    background: bg,
    border: "none",
    borderRadius: 6,
    color: "#fff",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    marginTop: 8,
    transition: "background 0.15s",
  };
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 6,
  color: "#e6edf3",
  fontSize: 14,
  outline: "none",
  marginBottom: 8,
  boxSizing: "border-box",
};
