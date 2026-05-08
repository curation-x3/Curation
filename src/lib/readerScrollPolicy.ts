export interface ReaderScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export const READER_NEAR_BOTTOM_PX = 220;
export const READER_SOFT_REVEAL_MAX_PX = 360;
export const READER_CHAT_TOP_OFFSET_PX = 96;

export function maxReaderScrollTop(metrics: ReaderScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}

export function isNearReaderBottom(
  metrics: ReaderScrollMetrics,
  thresholdPx = READER_NEAR_BOTTOM_PX,
): boolean {
  return maxReaderScrollTop(metrics) - metrics.scrollTop <= thresholdPx;
}

export function getSoftChatRevealTarget(
  metrics: ReaderScrollMetrics,
  chatTopInScroller: number,
  inputHeight: number,
): number {
  const effectiveBottom = metrics.scrollTop + metrics.clientHeight - inputHeight;
  const chatAlreadyComfortable = chatTopInScroller < effectiveBottom - 120;
  if (chatAlreadyComfortable) return metrics.scrollTop;

  const desired = Math.max(0, chatTopInScroller - READER_CHAT_TOP_OFFSET_PX);
  const capped = Math.min(desired, metrics.scrollTop + READER_SOFT_REVEAL_MAX_PX);
  return Math.min(maxReaderScrollTop(metrics), capped);
}

export function getReaderScrollMetrics(el: HTMLElement): ReaderScrollMetrics {
  return {
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  };
}
