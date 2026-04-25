import { useIsCardRunning } from "../lib/acp/store";
import { useCardStatus, type CardStatus } from "../lib/acp/cardStatusStore";

type Props = {
  cardId: string | null;
  className?: string;
};

const TITLE: Record<CardStatus, string> = {
  pending: "等待 ACP 回复",
  unread: "ACP 已回复（未读）",
  read: "ACP 已回复（已读）",
  error: "ACP 通信失败",
  closed: "ACP 会话已关闭",
};

/**
 * Per-card ACP status indicator.
 * - pending: emerald spinner
 * - unread:  large solid green dot
 * - read:    small solid green dot
 * - error:   red dot
 * - closed:  small gray dot
 */
export function AcpRunningDot({ cardId, className = "" }: Props) {
  const status = useCardStatus(cardId);
  const running = useIsCardRunning(cardId);

  // Fallback: a runtime is live for this card but no explicit status yet.
  // Treat as pending so the spinner shows up immediately.
  const effective: CardStatus | null = status ?? (running ? "pending" : null);
  if (!effective) return null;

  const title = TITLE[effective];

  if (effective === "pending") {
    return (
      <span
        className={`inline-block rounded-full border-2 border-emerald-500 border-t-transparent animate-spin ${className}`}
        style={{ width: 10, height: 10 }}
        title={title}
        aria-label={title}
      />
    );
  }

  const sizeByStatus: Record<Exclude<CardStatus, "pending">, number> = {
    unread: 10,
    read: 6,
    error: 8,
    closed: 6,
  };
  const colorByStatus: Record<Exclude<CardStatus, "pending">, string> = {
    unread: "bg-emerald-500",
    read: "bg-emerald-500",
    error: "bg-red-500",
    closed: "bg-gray-400",
  };

  const size = sizeByStatus[effective];
  const color = colorByStatus[effective];

  return (
    <span
      className={`inline-block rounded-full ${color} ${className}`}
      style={{ width: size, height: size }}
      title={title}
      aria-label={title}
    />
  );
}
