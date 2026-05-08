export function formatReadingMinutes(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "";
  return `${minutes} 分钟`;
}

export function formatWordCount(wordCount: number | null | undefined): string {
  if (!wordCount || wordCount <= 0) return "";
  return `约 ${wordCount} 字`;
}

export function formatReadingSummary(
  wordCount: number | null | undefined,
  minutes: number | null | undefined,
): string {
  return [formatWordCount(wordCount), formatReadingMinutes(minutes)]
    .filter(Boolean)
    .join(" · ");
}
