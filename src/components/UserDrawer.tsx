import { useMemo, useState } from "react";
import { X, Trash2, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { fmtTime } from "../lib/tableHelpers";
import { useAdminByUser } from "../hooks/useAdminSubscriptions";
import { SubscribeModal } from "./SubscribeModal";

interface UserRef {
  id: number;
  username: string | null;
  email: string | null;
  picture: string | null;
  role: string;
}

interface Props {
  user: UserRef | null;
  onClose: () => void;
}

export function UserDrawer({ user, onClose }: Props) {
  const [filter, setFilter] = useState<"active" | "all" | "ended">("active");
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const qc = useQueryClient();

  const includeEnded = filter !== "active";
  const { data: all = [] } = useAdminByUser(includeEnded);

  const windows = useMemo(() => {
    const row = all.find(r => r.user_id === user?.id);
    if (!row) return [];
    if (filter === "active") return row.windows.filter(w => !w.ended_at);
    if (filter === "ended") return row.windows.filter(w => !!w.ended_at);
    return row.windows;
  }, [all, user?.id, filter]);

  if (!user) return null;

  const closeWin = async (id: number) => {
    await apiFetch(`/api/admin/subscriptions/windows/${id}/close`, { method: "POST" });
    qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
  };
  const delWin = async (id: number) => {
    if (!confirm("删除此订阅记录？")) return;
    await apiFetch(`/api/admin/subscriptions/windows/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
  };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 150 }}
           onClick={onClose}>
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 560,
                      maxWidth: "90vw", background: "var(--bg-base)",
                      borderLeft: "1px solid var(--border)",
                      display: "flex", flexDirection: "column" }}
             onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", gap: 10,
                        padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            {user.picture ? (
              <img src={user.picture} alt=""
                   style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }} />
            ) : (
              <span style={{ width: 36, height: 36, borderRadius: "50%",
                             background: "var(--border)", display: "flex",
                             alignItems: "center", justifyContent: "center",
                             color: "var(--text-muted)", fontSize: "var(--fs-md)" }}>
                {(user.username || "?")[0]}
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "var(--text-primary)", fontSize: "var(--fs-md)", fontWeight: 600 }}>
                {user.username || "—"}
              </div>
              <div style={{ color: "var(--text-faint)", fontSize: "var(--fs-xs)" }}>
                {user.email} · {user.role}
              </div>
            </div>
            <button onClick={onClose}
                    style={{ background: "none", border: "none",
                             color: "var(--text-muted)", cursor: "pointer" }}>
              <X size={18} />
            </button>
          </div>

          <div style={{ display: "flex", gap: 12, padding: "0 16px",
                        borderBottom: "1px solid var(--border)" }}>
            <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-sm)",
                           fontWeight: 500, padding: "8px 4px",
                           borderBottom: "2px solid var(--accent-gold)" }}>
              订阅
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 16px", borderBottom: "1px solid var(--bg-panel)" }}>
            <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}
                    style={{ background: "var(--bg-panel)", color: "var(--text-primary)",
                             border: "1px solid var(--border)", borderRadius: 4,
                             padding: "2px 8px", fontSize: "var(--fs-xs)" }}>
              <option value="active">仅活跃</option>
              <option value="all">全部</option>
              <option value="ended">仅已结束</option>
            </select>
            <div style={{ flex: 1 }} />
            <button onClick={() => setSubscribeOpen(true)}
                    style={{ background: "var(--bg-panel)",
                             border: "1px solid var(--border)", borderRadius: 4,
                             color: "var(--accent-blue)", padding: "2px 8px",
                             cursor: "pointer", fontSize: "var(--fs-xs)",
                             display: "flex", alignItems: "center", gap: 4 }}>
              <Plus size={11} /> 添加公众号
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {windows.length === 0 ? (
              <div style={{ padding: 20, color: "var(--text-faint)",
                            fontSize: "var(--fs-sm)", textAlign: "center" }}>
                暂无订阅
              </div>
            ) : (
              <>
                <div style={{ display: "grid",
                              gridTemplateColumns: "minmax(160px,1fr) 100px 100px 110px",
                              padding: "6px 16px", borderBottom: "1px solid var(--bg-panel)",
                              background: "var(--bg-panel)", color: "var(--text-muted)",
                              fontSize: "var(--fs-xs)", fontWeight: 500,
                              position: "sticky", top: 0, zIndex: 1 }}>
                  <span>公众号</span>
                  <span style={{ textAlign: "center" }}>起始</span>
                  <span style={{ textAlign: "center" }}>状态</span>
                  <span style={{ textAlign: "center" }}>操作</span>
                </div>
                {windows.map(w => (
                  <div key={w.window_id}
                       style={{ display: "grid",
                                gridTemplateColumns: "minmax(160px,1fr) 100px 100px 110px",
                                padding: "8px 16px", alignItems: "center",
                                borderBottom: "1px solid var(--bg-panel)",
                                color: w.ended_at ? "var(--text-faint)" : "var(--text-primary)" }}>
                    <span style={{ fontSize: "var(--fs-sm)",
                                    overflow: "hidden", textOverflow: "ellipsis",
                                    whiteSpace: "nowrap" }}>
                      {w.name || w.biz}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)",
                                    textAlign: "center" }}>
                      {fmtTime(w.started_at)}
                    </span>
                    <span style={{ fontSize: "var(--fs-sm)", textAlign: "center",
                                    color: w.ended_at ? "var(--text-faint)" : "var(--accent-green)" }}>
                      {w.ended_at ? "已结束" : "活跃"}
                    </span>
                    <span style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      {!w.ended_at && (
                        <button onClick={() => closeWin(w.window_id)}
                                style={{ background: "var(--bg-panel)",
                                         border: "1px solid var(--border)", borderRadius: 4,
                                         color: "var(--text-muted)", padding: "2px 6px",
                                         cursor: "pointer", fontSize: "var(--fs-xs)" }}>
                          关闭
                        </button>
                      )}
                      <button onClick={() => delWin(w.window_id)}
                              style={{ background: "none", border: "none",
                                       color: "var(--text-muted)", cursor: "pointer" }}>
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {subscribeOpen && (
        <SubscribeModal
          open
          targetUserIds={[user.id]}
          onClose={() => setSubscribeOpen(false)}
          onSuccess={() => {
            setSubscribeOpen(false);
            qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
          }}
        />
      )}
    </>
  );
}
