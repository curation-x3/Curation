import { useEffect, useState } from "react";
import { authingClient } from "../lib/authing";
import { useAuth } from "../lib/authStore";

const API_BASE = "http://127.0.0.1:8889";

interface AuthCallbackProps {
  onDone: () => void;
}

export function AuthCallback({ onDone }: AuthCallbackProps) {
  const { login } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function handle() {
      try {
        // Exchange code for tokens
        const res = await authingClient.handleRedirectCallback();
        const idToken = res?.id_token || (res as any)?.idToken;
        const rawState = res?.state || "";

        let action = "login";
        let inviteToken = "";
        try {
          const parsed = JSON.parse(atob(rawState));
          action = parsed.action || "login";
          inviteToken = parsed.invite_token || "";
        } catch {
          // state might not be base64 JSON for older flows
        }

        let endpoint = "/auth/login";
        let body: Record<string, string> = { id_token: idToken };

        if (action === "register") {
          endpoint = "/auth/register";
          body = { id_token: idToken, invite_token: inviteToken };
        }

        const resp = await fetch(`${API_BASE}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await resp.json();
        if (!resp.ok) {
          if (!cancelled) setError(data.detail || "认证失败");
          return;
        }

        if (!cancelled) {
          login(idToken, {
            id: data.user_id,
            email: data.email || "",
            username: data.username || "",
            role: data.role,
          });
          // Clear the callback URL params
          window.history.replaceState({}, document.title, "/");
          onDone();
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "认证过程发生错误");
      }
    }

    handle();
    return () => { cancelled = true; };
  }, [login, onDone]);

  if (error) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d1117",
          color: "#f85149",
          fontSize: 14,
          flexDirection: "column",
          gap: 16,
        }}
      >
        <p>{error}</p>
        <button
          onClick={() => window.history.replaceState({}, document.title, "/")}
          style={{
            padding: "8px 16px",
            background: "#21262d",
            border: "1px solid #30363d",
            borderRadius: 6,
            color: "#e6edf3",
            cursor: "pointer",
          }}
        >
          返回登录
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0d1117",
        color: "#8b949e",
        fontSize: 14,
      }}
    >
      正在完成登录…
    </div>
  );
}
