import { open } from "@tauri-apps/plugin-dialog";

export async function openFolderPicker(options?: { title?: string }): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title: options?.title });
  if (typeof result === "string") return result;
  return null;
}
