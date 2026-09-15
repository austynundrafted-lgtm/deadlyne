// Settings that must survive updates and reinstalls live in the Tauri store file; small view
// preferences (thumbnail size, open sections) use localStorage.
import { LazyStore } from "@tauri-apps/plugin-store"

export const settingsStore = new LazyStore("settings.json")

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  return (await settingsStore.get<T>(key)) ?? fallback
}

export async function setSetting<T>(key: string, value: T) {
  await settingsStore.set(key, value)
  await settingsStore.save()
}

export function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

export function setPref<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or storage blocked: the preference just isn't remembered.
  }
}

// MARK: Profile

/** The photographer's optional profile, stored only on this computer. */
export interface Profile {
  name: string
  /** IPTC Credit, e.g. "Austyn McFadden Photography" or a publication. */
  credit: string
  /** `{year}` becomes each photo's capture year, `{name}` the name above. */
  copyright: string
}

export const DEFAULT_COPYRIGHT = "© {year} {name}"
