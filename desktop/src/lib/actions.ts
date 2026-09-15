// Actions shared by buttons, keyboard shortcuts and drag-and-drop.
import { open } from "@tauri-apps/plugin-dialog"
import { useStore } from "@/store"

export async function openFolderDialog() {
  const path = await open({ directory: true, multiple: false, title: "Open a shoot" })
  if (typeof path === "string") await useStore.getState().openFolder(path)
}
