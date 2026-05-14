import { useQuery } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { fetchCardSources, fetchClusterSources } from "../../lib/api";
import type { CardSource } from "../../types";
import { useDrawerStack } from "../../state/drawerStack";

type Props =
  | { mode: "card";    cardId: string }
  | { mode: "cluster"; clusterSignature: string };

export function SourceCardsView(props: Props) {
  const push = useDrawerStack((s) => s.push);
  const queryKey = props.mode === "card"
    ? ["cardSources", props.cardId]
    : ["clusterSources", props.clusterSignature];
  const queryFn = props.mode === "card"
    ? () => fetchCardSources(props.cardId)
    : () => fetchClusterSources(props.clusterSignature);
  const query = useQuery<CardSource[]>({
    queryKey,
    queryFn,
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return <div style={{ padding: 24, color: "var(--text-muted)", textAlign: "center" }}>加载中…</div>;
  }
  if (query.isError) {
    return (
      <div style={{ padding: 24, textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
        <div style={{ color: "var(--text-muted)" }}>加载失败</div>
        <button type="button" onClick={() => query.refetch()} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", border: "1px solid var(--bg-panel)", background: "transparent", color: "var(--text-primary)", borderRadius: 4, cursor: "pointer" }}>
          <RotateCw size={14} /> 重试
        </button>
      </div>
    );
  }
  const sources = query.data ?? [];
  if (sources.length === 0) {
    return <div style={{ padding: 24, color: "var(--text-muted)", textAlign: "center" }}>没有源卡片</div>;
  }

  return (
    <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      {sources.map((s) => {
        const articleId = s.article?.short_id;
        const accountName = s.article?.account;
        return (
          <div key={s.card_id} style={{ border: "1px solid var(--bg-panel)", borderRadius: 6, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontWeight: 500 }}>{s.title || "(无标题)"}</div>
            {accountName && (
              <div style={{ fontSize: "var(--fs-sm, 13px)", color: "var(--text-muted)" }}>{accountName}</div>
            )}
            {s.description && (
              <div style={{ fontSize: "var(--fs-sm, 13px)", color: "var(--text-secondary, var(--text-muted))", lineHeight: 1.5 }}>
                {s.description}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => push({ kind: "card", cardId: s.card_id })}
                style={{ padding: "4px 10px", border: "1px solid var(--bg-panel)", background: "transparent", color: "var(--text-primary)", borderRadius: 4, cursor: "pointer", fontSize: "var(--fs-sm, 13px)" }}
              >
                查看卡片
              </button>
              {articleId && (
                <button
                  type="button"
                  onClick={() => push({ kind: "article", articleId })}
                  style={{ padding: "4px 10px", border: "1px solid var(--bg-panel)", background: "transparent", color: "var(--text-primary)", borderRadius: 4, cursor: "pointer", fontSize: "var(--fs-sm, 13px)" }}
                >
                  查看原文
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
