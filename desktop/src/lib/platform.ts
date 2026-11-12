// The few things that differ on iPad. Pickers: an iPad app can only read folders and files the
// photographer picks in Files, so they go through the native ipad-files plugin, which keeps
// access across relaunches. Finder actions become Quick Look and the share sheet.
import { Channel, invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { isIPad } from "@/lib/format"
import { isMacAppStore } from "@/lib/distribution"

/** The picker can stay open for minutes; acknowledge IPC now and receive its result later. */
function pickOnIPad<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const onResult = new Channel<{ result: T; error?: never } | { error: string; result?: never }>((message) => {
      if (message.error !== undefined) reject(new Error(message.error))
      else resolve(message.result)
    })
    invoke(`plugin:ipad-files|${command}`, { ...args, onResult }).catch(reject)
  })
}

/** A folder the photographer picks (a shoot, a card, a destination), or null if cancelled. */
export async function pickFolder(title: string): Promise<string | null> {
  if (isMacAppStore) return (await pickInStore("store_pick", { title, directory: true, multiple: false }))[0] ?? null
  if (isIPad) return (await pickOnIPad<{ path: string | null }>("pick_folder")).path
  const path = await open({ directory: true, multiple: false, title })
  return typeof path === "string" ? path : null
}

/** Files the photographer picks; empty if cancelled. */
export async function pickFiles(title: string, opts: { multiple?: boolean; extensions?: string[] } = {}): Promise<string[]> {
  const multiple = opts.multiple ?? true
  if (isMacAppStore) {
    const paths = await pickInStore("store_pick", { title, directory: false, multiple })
    return opts.extensions ? paths.filter((p) => opts.extensions!.some((e) => p.toLowerCase().endsWith(`.${e}`))) : paths
  }
  if (isIPad) {
    const { paths } = await pickOnIPad<{ paths: string[] }>("pick_files", { multiple })
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
let restoring: Promise<[string, string][]> | null = null
export function restoreAccess(): Promise<[string, string][]> {
  if (!restoring) restoring = restoreNativeAccess().catch((error) => { restoring = null; throw error })
  return restoring
}

async function restoreNativeAccess(): Promise<[string, string][]> {
  if (isMacAppStore) {
    const restored = await invoke<{ saved: string; current: string | null }[]>("store_restore_access")
    // Source/destination paths belong to this device. Follow moved bookmarks before preferences
    // and folder listings load; never send their paths to the account's preset storage.
    const moved = restored.filter((r) => r.current && r.current !== r.saved).map((r): [string, string] => [r.saved, r.current!])
    if (moved.length) {
      const { getSetting, setSetting } = await import("@/lib/settings")
      for (const key of ["ingest", "export"]) {
        const prefs = await getSetting<Record<string, unknown> | null>(key, null)
        if (!prefs || typeof prefs.destination !== "string") continue
        const match = moved.find(([from]) => prefs.destination === from || (prefs.destination as string).startsWith(from + "/"))
        if (match) await setSetting(key, { ...prefs, destination: match[1] + prefs.destination.slice(match[0].length) })
      }
    }
    return moved
  }
  if (!isIPad) return []
  try {
    const { restored } = await invoke<{ restored: { saved: string; current: string | null }[] }>("plugin:ipad-files|restore_access")
    return restored.filter((r) => r.current && r.current !== r.saved).map((r) => [r.saved, r.current!])
  } catch {
    return []
  }
}

function pickInStore(command: string, args: Record<string, unknown>): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const onResult = new Channel<{ result: { paths: string[] }; error?: never } | { error: string; result?: never }>((message) => {
      if (message.error !== undefined) reject(new Error(message.error))
      else resolve(message.result.paths)
    })
    invoke(command, { ...args, onResult }).catch(reject)
  })
}

/** A remembered path may need a fresh user grant after migration or revoked permissions. */
export async function authorizeFolder(path: string): Promise<boolean> {
  if (!isMacAppStore) return true
  await restoreAccess()
  return (await pickInStore("store_authorize", { path })).length > 0
}
