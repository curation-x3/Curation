import { useEffect } from "react";
import { ReaderPane } from "../../components/ReaderPane";
import type { MapCard } from "../types";

type Props = {
  open: boolean;
  card: MapCard | null;
  onClose: () => void;
};

export function MapPreviewDrawer({ open, card, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !card) return null;

  return (
    <div className="drawer-overlay" data-map-fixed-ui onClick={onClose}>
      <aside className="drawer-panel map-reader-drawer" onClick={(e) => e.stopPropagation()}>
        <ReaderPane
          selectedItem={card}
          selectedDiscardedItem={null}
          isDiscardedView={false}
          isHomeView={false}
        />
      </aside>
    </div>
  );
}
