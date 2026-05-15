import { useMemo } from "react";
import { useInbox } from "../../hooks/useInbox";
import { ReaderPane } from "../ReaderPane";
import { CardContentView } from "./CardContentView";

/**
 * Drawer view for `kind: "card"`.
 *
 * Restores the pre-refactor map-preview behavior: opening a card from the
 * atlas (or any other drawer trigger) presents the FULL reader — chat input,
 * vote bar, and the "AI 卡片 + 原文" twin-frame layout for original-content
 * routings — not just the bare card markdown.
 *
 * Before the unified-drawer refactor this was handled by MapPreviewDrawer
 * literally embedding `<ReaderPane>` inside a `drawer-panel`. The refactor
 * replaced that with a stripped-down `CardContentView` that only rendered
 * markdown, which dropped:
 *   1. ChatInput (lives in ReaderPane)
 *   2. The 原文 frame for original_content_with_pre_card / _post_card
 *
 * The lookup goes through `useInbox()` so we reuse the existing
 * CachedCard→InboxItem conversion. If the card isn't in the local inbox
 * cache (e.g. a source-card preview the user never subscribed to) we
 * gracefully fall back to the bare markdown view.
 */
export function CardReaderView({ cardId }: { cardId: string }) {
  const { data: items } = useInbox(undefined, false, true);
  const item = useMemo(
    () => items?.find((i) => i.card_id === cardId) ?? null,
    [items, cardId],
  );

  if (!item) {
    // Not in local inbox — show the bare markdown body. This still works
    // for source-card peeks that bypass the subscription set.
    return <CardContentView cardId={cardId} />;
  }

  return (
    <ReaderPane
      selectedItem={item}
      selectedDiscardedItem={null}
      isDiscardedView={false}
      isHomeView={false}
    />
  );
}
