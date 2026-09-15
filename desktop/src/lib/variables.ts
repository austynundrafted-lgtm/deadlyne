// Per-photo caption variables, filled in from each photo's capture metadata when a caption is
// saved: "{date}" becomes "August 22, 2026" on every selected photo. Port of CaptionExpander.swift.
import type { Photo } from "./api"

export const VARIABLES = [
  "{date}", "{weekday}", "{shortdate}", "{time}", "{camera}", "{lens}", "{focal}", "{shutter}", "{aperture}", "{iso}", "{filename}",
] as const

export function expandVariables(text: string, photo: Photo): string {
  if (!text.includes("{")) return text
  const m = photo.meta
  const date = parseCaptured(m?.captured)
  const values: Record<string, string> = {
    "{date}": date ? date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "",
    "{weekday}": date ? date.toLocaleDateString("en-US", { weekday: "long" }) : "",
    "{shortdate}": m?.captured?.slice(0, 10) ?? "",
    "{time}": date ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
    "{camera}": m?.camera ?? "",
    "{lens}": m?.lens ?? "",
    "{filename}": photo.name,
    "{iso}": m?.iso ? String(m.iso) : "",
    "{focal}": m?.focalLength ? `${+m.focalLength.toFixed(1)}mm` : "",
    "{aperture}": m?.fNumber ? `f/${+m.fNumber.toFixed(1)}` : "",
    "{shutter}": m?.exposure ? (m.exposure >= 0.5 ? `${+m.exposure.toFixed(1)}"` : `1/${Math.round(1 / m.exposure)}`) : "",
  }
  return text.replace(/\{[a-z]+\}/gi, (token) => values[token.toLowerCase()] ?? token)
}

export function parseCaptured(captured?: string | null): Date | null {
  const m = captured?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null
}
