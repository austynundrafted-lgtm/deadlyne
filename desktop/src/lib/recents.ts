// Recently opened shoots, kept in the app's settings file (Tauri store plugin).
import { LazyStore } from "@tauri-apps/plugin-store"

export interface RecentShoot {
  path: string
  name: string
  photos: number
  openedAt: number
}

const store = new LazyStore("settings.json")
const KEY = "recentShoots"
const LIMIT = 12

type Listener = (list: RecentShoot[]) => void
const listeners = new Set<Listener>()

export async function recentShoots(): Promise<RecentShoot[]> {
  return (await store.get<RecentShoot[]>(KEY)) ?? []
}

export function onRecentShoots(fn: Listener) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export async function noteRecentShoot(path: string, photos: number) {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
  const list = [{ path, name, photos, openedAt: Date.now() }, ...(await recentShoots()).filter((s) => s.path !== path)]
  await save(list.slice(0, LIMIT))
}

export async function forgetRecentShoot(path: string) {
  await save((await recentShoots()).filter((s) => s.path !== path))
}

async function save(list: RecentShoot[]) {
  await store.set(KEY, list)
  await store.save()
  listeners.forEach((fn) => fn(list))
}
