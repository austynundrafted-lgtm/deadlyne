// The few things that differ on iPad. Pickers: an iPad app can only read folders and files the
// photographer picks in Files, so they go through the native ipad-files plugin, which keeps
// access across relaunches. Finder actions become Quick Look and the share sheet.
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { isIPad } from "@/lib/format"

/** A folder the photographer picks (a shoot, a card, a destination), or null if cancelled. */
export async function pickFolder(title: string): Promise<string | null> {
  if (isIPad) return (await invoke<{ path: string | null }>("plugin:ipad-files|pick_folder")).path
  const path = await open({ directory: true, multiple: false, title })
  return typeof path === "string" ? path : null
}

/** Files the photographer picks; empty if cancelled. */
export async function pickFiles(title: string, opts: { multiple?: boolean; extensions?: string[] } = {}): Promise<string[]> {
  const multiple = opts.multiple ?? true
  if (isIPad) {
    const { paths } = await invoke<{ paths: string[] }>("plugin:ipad-files|pick_files", { multiple })
    return opts.extensions ? paths.filter((p) => opts.extensions!.some((e) => p.toLowerCase().endsWith(`.${e}`))) : paths
  }
  const picked = await open({
    multiple,
    directory: false,
    title,
    filters: opts.extensions ? [{ name: "Files", extensions: opts.extensions }] : undefined,
  })
  return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : []
}

/** iPad: the share sheet (open in another app, save to Files, AirDrop…). */
export const share = (paths: string[]) => invoke("plugin:ipad-files|share", { paths })

/** Quick Look: the system preview on iPad, Finder's on Mac. */
export const preview = (path: string) => (isIPad ? invoke("plugin:ipad-files|preview", { path }) : invoke("quick_look", { path }))

/**
 * iPad: reopen every folder and file picked before (access ends when the app quits). Returns the
 * ones that moved, as [old path, new path], so the library can follow them.
 */
export async function restoreAccess(): Promise<[string, string][]> {
  if (!isIPad) return []
  try {
    const { restored } = await invoke<{ restored: { saved: string; current: string | null }[] }>("plugin:ipad-files|restore_access")
    return restored.filter((r) => r.current && r.current !== r.saved).map((r) => [r.saved, r.current!])
  } catch {
    return []
  }
}
