// Atlas — left-side panel listing shared entities (the ones that produce
// trade-route connections). Clicking an entity pins the focus on that
// entity's constellation, the same as clicking one of its lines on the map.

import { useMapStore } from "../state/store";

type EntityRow = {
  name: string;
  cardCount: number;
};

type Props = {
  entities: EntityRow[];
  selectedEntity: string | null;
  onSelect: (entity: string) => void;
};

export function MapEntityList({
  entities,
  selectedEntity,
  onSelect,
}: Props) {
  const routesVisible = useMapStore((s) => s.routes_visible);
  const hiddenEntities = useMapStore((s) => s.hidden_entities);
  const toggleHidden = useMapStore((s) => s.toggleEntityHidden);

  if (entities.length === 0 || !routesVisible) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 206,
        left: 28,
        width: 196,
        maxHeight: "calc(100vh - 286px)",
        overflowY: "auto",
        background: "var(--map-vellum)",
        border: "1px solid var(--map-ink)",
        boxShadow: "var(--map-shadow-vellum)",
        fontFamily: "var(--map-serif)",
        fontSize: 12,
        color: "var(--map-ink-2)",
        zIndex: 5,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          fontFamily: "var(--map-display)",
          fontSize: 11,
          letterSpacing: "0.18em",
          color: "var(--map-ink)",
          padding: "10px 12px 6px",
          borderBottom: "1px solid var(--map-ink-2)",
          textTransform: "uppercase",
          background: "var(--map-vellum)",
          position: "sticky",
          top: 0,
        }}
      >
        共享实体 · {entities.length}
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: "4px 0",
        }}
      >
        {entities.map((e) => {
          const isSelected = selectedEntity === e.name;
          const isHidden = hiddenEntities.has(e.name);
          return (
            <li
              key={e.name}
              onClick={() => {
                if (isHidden) return; // hidden rows are inert until shown
                onSelect(e.name);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 6px 4px 10px",
                cursor: isHidden ? "default" : "pointer",
                background: isSelected
                  ? "var(--map-crimson)"
                  : "transparent",
                color: isSelected
                  ? "var(--map-vellum)"
                  : isHidden
                    ? "var(--map-ink-faint)"
                    : "var(--map-ink-2)",
                fontWeight: isSelected ? 500 : 400,
                opacity: isHidden ? 0.55 : 1,
                textDecoration: isHidden ? "line-through" : "none",
                transition: "background 120ms, opacity 120ms",
                userSelect: "none",
              }}
              onMouseEnter={(ev) => {
                if (isSelected) return;
                (ev.currentTarget as HTMLElement).style.background =
                  "var(--map-paper)";
              }}
              onMouseLeave={(ev) => {
                if (isSelected) return;
                (ev.currentTarget as HTMLElement).style.background =
                  "transparent";
              }}
            >
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {e.name}
              </span>
              <span
                style={{
                  fontFamily: "var(--map-mono)",
                  fontSize: 10,
                  color: isSelected
                    ? "var(--map-vellum)"
                    : "var(--map-ink-faint)",
                  flexShrink: 0,
                }}
              >
                {e.cardCount}
              </span>
              {/* Visibility toggle. Hides this entity's lines on the map
                  without removing it from the list (so user can re-show). */}
              <button
                type="button"
                title={isHidden ? "显示这条线" : "隐藏这条线"}
                onClick={(ev) => {
                  ev.stopPropagation();
                  toggleHidden(e.name);
                }}
                style={{
                  width: 18,
                  height: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 11,
                  color: isSelected
                    ? "var(--map-vellum)"
                    : "var(--map-ink-faint)",
                  opacity: 0.7,
                  flexShrink: 0,
                }}
                onMouseEnter={(ev) => {
                  (ev.currentTarget as HTMLElement).style.opacity = "1";
                }}
                onMouseLeave={(ev) => {
                  (ev.currentTarget as HTMLElement).style.opacity = "0.7";
                }}
              >
                {isHidden ? "○" : "●"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
