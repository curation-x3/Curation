import { invoke } from "@tauri-apps/api/core";

export async function openExternal(url: string): Promise<void> {
  try {
    await invoke("open_url_window", { url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
