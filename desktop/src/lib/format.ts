import type { Meta } from "./api"

const ua = navigator.userAgent
/** Deadlyne for iPad. iPadOS's web view says it's a Mac, so touch is what gives it away. */
export const isIPad = /iPad/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1)
/** Desktop macOS (not iPad). */
export const isMac = ua.includes("Mac") && !isIPad
const appleKeys = isMac || isIPad

/** "⌘" on Mac and iPad keyboards, "Ctrl+" on Windows. */
export const mod = appleKeys ? "⌘" : "Ctrl+"
/** "⌥" / "Alt+" and "⇧" / "Shift+", for shortcuts written out in full. */
export const alt = appleKeys ? "⌥" : "Alt+"
export const shift = appleKeys ? "⇧" : "Shift+"

/** Where deleted things go, by name. */
export const trashName = isIPad ? "Recently Deleted" : isMac ? "the Trash" : "the Recycle Bin"
/** The delete command's name: everything deleted can be put back. */
export const trashAction = isIPad ? "Move to Recently Deleted" : "Move to Trash"
/** "Show in Finder" and "Open in default app" become the share sheet on iPad. */
export const revealLabel = isIPad ? "Share…" : `Show in ${isMac ? "Finder" : "Explorer"}`
export const openLabel = isIPad ? "Open in…" : "Open in default app"

export const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`

export function exposureLine(m?: Meta): string {
  if (!m) return ""
  const bits: string[] = []
  if (m.focalLength) bits.push(`${+m.focalLength.toFixed(1)}mm`)
  if (m.exposure) bits.push(m.exposure >= 0.5 ? `${+m.exposure.toFixed(1)}″` : `1/${Math.round(1 / m.exposure)}`)
  if (m.fNumber) bits.push(`f/${+m.fNumber.toFixed(1)}`)
  if (m.iso) bits.push(`ISO ${m.iso}`)
  return bits.join(" · ")
}

export function captureTime(m?: Meta): string {
  if (!m?.captured) return ""
  const [date, time = ""] = m.captured.split("T")
  const [y, mo, d] = date.split("-").map(Number)
  const [h, mi, s] = time.split(":")
  const hour = Number(h)
  const month = new Date(y, mo - 1, d).toLocaleString(undefined, { month: "short" })
  return `${month} ${d}, ${y} · ${hour % 12 || 12}:${mi}:${s} ${hour < 12 ? "AM" : "PM"}`
}

export function relativeTime(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "yesterday" : `${days} days ago`
}

/** CSS transform that turns a sensor-oriented image upright for EXIF orientation 1–8. */
export function orientationTransform(o: number): { transform: string; swapsAxes: boolean } {
  switch (o) {
    case 2: return { transform: "scaleX(-1)", swapsAxes: false }
    case 3: return { transform: "rotate(180deg)", swapsAxes: false }
    case 4: return { transform: "scaleY(-1)", swapsAxes: false }
    case 5: return { transform: "rotate(90deg) scaleX(-1)", swapsAxes: true }
    case 6: return { transform: "rotate(90deg)", swapsAxes: true }
    case 7: return { transform: "rotate(-90deg) scaleX(-1)", swapsAxes: true }
    case 8: return { transform: "rotate(-90deg)", swapsAxes: true }
    default: return { transform: "none", swapsAxes: false }
  }
}

export const labelColor = (label: string | null) => (label ? `var(--label-${label.toLowerCase()})` : undefined)
