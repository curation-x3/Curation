export function openExternal(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}
