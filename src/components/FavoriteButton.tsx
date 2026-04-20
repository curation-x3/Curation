import { Star } from "lucide-react";
import { useFavoriteSet, useToggleFavorite } from "../hooks/useFavorites";

interface FavoriteButtonProps {
  itemType: "card" | "article";
  itemId: string;
  size?: number;
}

export function FavoriteButton({ itemType, itemId, size = 12 }: FavoriteButtonProps) {
  const favoriteSet = useFavoriteSet();
  const toggle = useToggleFavorite();
  const isFavorited = favoriteSet.has(`${itemType}:${itemId}`);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        toggle.mutate({ itemType, itemId, isFavorited });
      }}
      disabled={toggle.isPending}
      title={isFavorited ? "取消收藏" : "收藏"}
      style={{
        background: "none",
        border: "1px solid #30363d",
        borderRadius: 6,
        color: isFavorited ? "#e3b341" : "#8b949e",
        padding: "3px 10px",
        cursor: toggle.isPending ? "wait" : "pointer",
        fontSize: "var(--fs-sm)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        opacity: toggle.isPending ? 0.6 : 1,
      }}
    >
      <Star size={size} fill={isFavorited ? "#e3b341" : "none"} />
      {isFavorited ? "已收藏" : "收藏"}
    </button>
  );
}
