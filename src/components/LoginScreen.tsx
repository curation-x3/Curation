import React from "react";
import { authingClient } from "../lib/authing";
import { resetCallback } from "./AuthCallback";

export function LoginScreen() {
  function handleEnter() {
    resetCallback();
    authingClient.loginWithRedirect();
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg-base)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "40px 48px",
        width: 360,
        color: "var(--text-primary)",
        textAlign: "center",
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 10px", letterSpacing: "-0.01em" }}>Curation</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 32px", fontFamily: "var(--font-body)", fontStyle: "italic", lineHeight: 1.6 }}>值得读完的文章，远比你以为的少。</p>
        <button onClick={handleEnter} style={primaryBtn}>
          登录 / 注册
        </button>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "10px 0",
  background: "var(--accent-green)",
  border: "none",
  borderRadius: 6,
  color: "#fff",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};
