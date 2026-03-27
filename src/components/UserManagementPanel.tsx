import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

interface AppUser {
  id: number;
  email: string;
  username: string;
  role: "admin" | "user";
  is_active: boolean;
  created_at: string;
  last_login: string | null;
}

export function UserManagementPanel() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchUsers() {
    setLoading(true);
    const resp = await apiFetch("/users");
    if (resp.ok) setUsers(await resp.json());
    setLoading(false);
  }

  useEffect(() => { fetchUsers(); }, []);

  async function handleUpdate(userId: number, patch: { role?: string; is_active?: boolean }) {
    await apiFetch(`/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await fetchUsers();
  }

  return (
    <div style={{ padding: 20, color: "#e6edf3", fontSize: 13 }}>
      <h2 style={{ margin: "0 0 20px", fontSize: 15, fontWeight: 600 }}>用户管理</h2>

      {loading ? (
        <p style={{ color: "#8b949e" }}>加载中…</p>
      ) : users.length === 0 ? (
        <p style={{ color: "#8b949e" }}>暂无用户</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#8b949e", borderBottom: "1px solid #30363d" }}>
              <th style={th}>邮箱</th>
              <th style={th}>用户名</th>
              <th style={th}>角色</th>
              <th style={th}>状态</th>
              <th style={th}>注册时间</th>
              <th style={th}>最后登录</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: "1px solid #21262d" }}>
                <td style={td}>{u.email || "—"}</td>
                <td style={{ ...td, color: "#8b949e" }}>{u.username || "—"}</td>
                <td style={td}>
                  <select
                    value={u.role}
                    onChange={(e) => handleUpdate(u.id, { role: e.target.value })}
                    style={{
                      background: "#0d1117",
                      border: "1px solid #30363d",
                      borderRadius: 4,
                      color: u.role === "admin" ? "#f0883e" : "#e6edf3",
                      fontSize: 12,
                      padding: "2px 6px",
                    }}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td style={td}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={u.is_active}
                      onChange={(e) => handleUpdate(u.id, { is_active: e.target.checked })}
                    />
                    <span style={{ color: u.is_active ? "#3fb950" : "#8b949e" }}>
                      {u.is_active ? "活跃" : "禁用"}
                    </span>
                  </label>
                </td>
                <td style={{ ...td, color: "#8b949e" }}>
                  {u.created_at ? u.created_at.slice(0, 10) : "—"}
                </td>
                <td style={{ ...td, color: "#8b949e" }}>
                  {u.last_login ? u.last_login.slice(0, 10) : "从未"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 12px",
  fontWeight: 500,
  fontSize: 12,
};

const td: React.CSSProperties = {
  padding: "8px 12px",
};
