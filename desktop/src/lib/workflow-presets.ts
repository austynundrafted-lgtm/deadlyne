import { LazyStore } from "@tauri-apps/plugin-store"
import { create } from "zustand"
import { supabase, useAuth } from "@/lib/auth"
import { presetName, presetOptions, readPreset, type PresetKind, type WorkflowPreset } from "@/lib/preset-options"

const cache = new LazyStore("account-presets.json")
const columns = "id,user_id,kind,name,settings,version"
interface PresetState {
  ownerId: string | null
  items: WorkflowPreset[]
  loaded: boolean
  loading: boolean
  writing: boolean
  error: string | null
}
export const usePresets = create<PresetState>(() => ({ ownerId: null, items: [], loaded: false, loading: false, writing: false, error: null }))

let generation = 0
let cacheWrites: Promise<void> = Promise.resolve()
let refreshing: { generation: number; work: Promise<void> } | null = null

function owner() {
  const s = useAuth.getState()
  return supabase && s.status === "signedIn" && s.access === "active" && !s.bypassed && !s.accountOperation ? s.account?.id ?? null : null
}
const current = (id: string, revision: number) => owner() === id && generation === revision
const ordered = (items: WorkflowPreset[]) => [...items].sort((a, b) => a.name.localeCompare(b.name))
function message(error: unknown) {
  const e = error as { code?: string; message?: string }
  if (e?.code === "23505") return "There’s already a preset with that name. Choose another name."
  if (["42P01", "PGRST205"].includes(e?.code ?? "")) return "Account presets haven’t been set up on the server yet. Your current settings still work."
  return error instanceof Error ? error.message : "Couldn’t sync account presets. Try again when you’re connected."
}

async function persist(id: string, revision: number) {
  const items = usePresets.getState().items
  const work = cacheWrites.catch(() => {}).then(async () => {
    if (!current(id, revision)) return
    await cache.set("cache", { ownerId: id, items })
    await cache.save()
  })
  cacheWrites = work
  try { await work }
  catch { if (current(id, revision)) usePresets.setState({ error: "Presets are synced, but their offline copy couldn’t be saved on this device." }) }
}

/** Account cleanup drains earlier writes before removing the cache, including after deletion. */
export async function clearPresetCache() {
  generation++
  refreshing = null
  usePresets.setState({ ownerId: null, items: [], loaded: false, loading: false, writing: false, error: null })
  const work = cacheWrites.catch(() => {}).then(async () => {
    await cache.delete("cache")
    await cache.save()
  })
  cacheWrites = work
  await work
}

/** Cached presets remain usable offline; saving/editing requires a server acknowledgement. */
export function refreshPresets(): Promise<void> {
  const id = owner()
  if (!id || usePresets.getState().writing) return Promise.resolve()
  if (usePresets.getState().ownerId !== id) {
    generation++
    usePresets.setState({ ownerId: id, items: [], loaded: false, error: null })
  }
  const revision = generation
  if (refreshing?.generation === revision) return refreshing.work
  usePresets.setState({ loading: true })
  const work = (async () => {
    try {
      if (!usePresets.getState().loaded) {
        await cacheWrites.catch(() => {})
        const saved = await cache.get<{ ownerId: string; items: unknown[] }>("cache")
        if (!current(id, revision)) return
        if (saved?.ownerId === id && Array.isArray(saved.items)) {
          try { usePresets.setState({ items: ordered(saved.items.map((item) => readPreset(item, id))) }) }
          catch { /* An invalid cache never becomes account data; replace it from the server. */ }
        }
        usePresets.setState({ loaded: true })
      }
      if (!current(id, revision) || useAuth.getState().offline || (typeof navigator !== "undefined" && navigator.onLine === false)) return
      const { data, error } = await supabase!.from("workflow_presets").select(columns).eq("user_id", id)
      if (!current(id, revision)) return
      if (error) throw error
      const items = ordered((data ?? []).map((item) => readPreset(item, id)))
      usePresets.setState({ items, error: null })
      await persist(id, revision)
    } catch (error) {
      if (current(id, revision)) usePresets.setState({ error: message(error) })
    } finally {
      if (generation === revision) usePresets.setState({ loading: false })
    }
  })()
  refreshing = { generation: revision, work }
  void work.then(() => { if (refreshing?.work === work) refreshing = null })
  return work
}

async function mutate<T>(operation: (id: string) => Promise<T>, apply: (result: T) => void): Promise<T> {
  const id = owner()
  if (!id) throw new Error("Sign in to save account presets.")
  if (useAuth.getState().offline || (typeof navigator !== "undefined" && navigator.onLine === false)) throw new Error("Connect to the internet to change account presets. Saved presets are available offline.")
  if (usePresets.getState().writing) throw new Error("Wait for the current preset change to finish.")
  const initialRefresh = usePresets.getState().ownerId !== id ? refreshPresets() : null
  const revision = generation
  usePresets.setState({ writing: true })
  try {
    // A list fetched before this change must finish before we apply the change.
    await (initialRefresh ?? refreshing?.work)
    if (!current(id, revision)) throw new Error("Your sign-in changed. Reopen the presets and try again.")
    const result = await operation(id)
    if (!current(id, revision)) throw new Error("Your sign-in changed. Reopen the presets and try again.")
    apply(result)
    usePresets.setState({ error: null })
    await persist(id, revision)
    return result
  } catch (error) {
    const reason = message(error)
    if (current(id, revision)) usePresets.setState({ error: reason })
    throw new Error(reason)
  } finally {
    if (generation === revision) usePresets.setState({ writing: false })
  }
}

export async function savePreset(kind: PresetKind, name: string, input: unknown, previous?: WorkflowPreset): Promise<WorkflowPreset> {
  const settings = presetOptions(kind, input)
  const cleanName = presetName(name)
  return mutate(async (id) => {
    if (previous && (previous.user_id !== id || previous.kind !== kind)) throw new Error("That preset belongs to another account or workflow.")
    const table = supabase!.from("workflow_presets")
    const request = previous
      ? table.update({ name: cleanName, settings }).eq("user_id", id).eq("id", previous.id).eq("version", previous.version)
      : table.insert({ user_id: id, kind, name: cleanName, settings })
    const { data, error } = await request.select(columns).maybeSingle()
    if (error) throw error
    if (!data) throw new Error("This preset changed on another device. Refresh presets, then choose it again before editing.")
    return readPreset(data, id)
  }, (saved) => usePresets.setState((s) => ({ items: ordered([...s.items.filter((p) => p.id !== saved.id), saved]) })))
}

/** Caller confirms removal first. Revision matching also protects against a stale confirmation. */
export async function deletePreset(preset: WorkflowPreset): Promise<void> {
  await mutate(async (id) => {
    if (preset.user_id !== id) throw new Error("That preset belongs to another account.")
    const { data, error } = await supabase!.from("workflow_presets").delete().eq("user_id", id).eq("id", preset.id).eq("version", preset.version).select("id").maybeSingle()
    if (error) throw error
    if (!data) throw new Error("This preset changed on another device. Refresh presets before removing it.")
  }, () => usePresets.setState((s) => ({ items: s.items.filter((p) => p.id !== preset.id) })))
}

export function initPresetSync() {
  const refresh = () => { if (document.visibilityState === "visible") void refreshPresets() }
  void refreshPresets()
  window.addEventListener("online", refresh)
  window.addEventListener("focus", refresh)
  document.addEventListener("visibilitychange", refresh)
  return () => {
    window.removeEventListener("online", refresh)
    window.removeEventListener("focus", refresh)
    document.removeEventListener("visibilitychange", refresh)
  }
}
