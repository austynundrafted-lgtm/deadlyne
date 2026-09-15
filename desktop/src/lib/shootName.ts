// A readable name for a shoot folder. Folder names are written for the file system:
// "Boys_Varsity-Fairborn-vs-Tecumseh_082126" reads as "Fairborn vs. Tecumseh", with
// "Boys Varsity" and Aug 21, 2026 as context. Port of the Mac app's ShootName.swift.

export interface ShootName {
  title: string
  /** Team level or sport pulled out of the name ("Boys Varsity"). */
  context: string | null
  /** A date written into the name. */
  date: Date | null
}

const VERSUS = new Set(["vs", "vs.", "v", "v.", "versus"])
const CONTEXT_WORDS = new Set([
  "boys", "girls", "men", "mens", "men's", "women", "womens", "women's", "coed",
  "varsity", "jv", "reserve", "freshman", "frosh", "junior", "senior", "hs", "ms", "ncaa",
  "football", "soccer", "basketball", "volleyball", "baseball", "softball", "lacrosse", "hockey",
  "wrestling", "tennis", "golf", "track", "xc", "swim", "swimming", "diving", "cheer", "bowling",
  "rugby", "gymnastics",
])

export function shootName(folderName: string): ShootName {
  let text = folderName
  let date: Date | null = null

  // Dashed dates first ("2026-09-11"), since "-" also separates words.
  const dashed = text.match(/(19|20)\d\d[-.](1[0-2]|0?[1-9])[-.](3[01]|[12]\d|0?[1-9])(?!\d)/)
  if (dashed) {
    const [y, m, d] = dashed[0].split(/[-.]/).map(Number)
    date = makeDate(y, m, d)
    text = text.replace(dashed[0], "_")
  }

  // Words, remembering which "_"-separated chunk each came from.
  let words = text
    .split("_")
    .flatMap((chunk, c) => chunk.split(/[- ]/).filter(Boolean).map((w) => ({ text: w, chunk: c })))

  if (!date) {
    const i = words.findIndex((w) => parseDigits(w.text))
    if (i >= 0) {
      date = parseDigits(words[i].text)
      words.splice(i, 1)
    }
  }

  const context: string[] = []
  while (words.length && CONTEXT_WORDS.has(words[0].text.toLowerCase())) context.push(words.shift()!.text)
  const trailing: string[] = []
  while (words.length && CONTEXT_WORDS.has(words[words.length - 1].text.toLowerCase())) trailing.unshift(words.pop()!.text)
  context.push(...trailing)

  const spaced = (ws: typeof words) => ws.map((w) => splitCamelCase(w.text)).join(" ")
  let title: string
  const v = words.findIndex((w) => VERSUS.has(w.text.toLowerCase()))
  if (v > 0 && v < words.length - 1) {
    title = `${spaced(words.slice(0, v))} vs. ${spaced(words.slice(v + 1))}`
  } else {
    // No matchup: keep the folder's own grouping.
    const chunks = new Map<number, typeof words>()
    for (const w of words) chunks.set(w.chunk, [...(chunks.get(w.chunk) ?? []), w])
    title = [...chunks.entries()].sort((a, b) => a[0] - b[0]).map(([, ws]) => spaced(ws)).join(" · ")
  }

  if (!title) {
    title = context.length ? context.join(" ") : folderName
    context.length = 0
  }
  return { title, context: context.length ? context.join(" ") : null, date }
}

/** "TippCity" → "Tipp City". Leaves "McFadden", "JV" and "iPhone" alone. */
export function splitCamelCase(s: string): string {
  const chars = [...s]
  if (chars.length < 2) return s
  const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase()
  const isLower = (c: string) => c !== c.toUpperCase() && c === c.toLowerCase()
  const cuts = chars.map((_, i) => i).filter((i) => i > 0 && isUpper(chars[i]) && isLower(chars[i - 1]))
  let out = ""
  let start = 0
  cuts.forEach((cut, n) => {
    const end = n + 1 < cuts.length ? cuts[n + 1] : chars.length
    if (cut - start >= 3 && end - cut >= 3) {
      out += chars.slice(start, cut).join("") + " "
      start = cut
    }
  })
  return out + chars.slice(start).join("")
}

/** "082126" (MMDDYY), "260821" (YYMMDD), "20260821" or "08212026". */
function parseDigits(s: string): Date | null {
  if (!/^\d+$/.test(s)) return null
  const num = (a: number, b: number) => Number(s.slice(a, b))
  if (s.length === 6) return makeDate(2000 + num(4, 6), num(0, 2), num(2, 4)) ?? makeDate(2000 + num(0, 2), num(2, 4), num(4, 6))
  if (s.length === 8) {
    return num(0, 2) >= 19 && num(0, 2) <= 20 ? makeDate(num(0, 4), num(4, 6), num(6, 8)) : makeDate(num(4, 8), num(0, 2), num(2, 4))
  }
  return null
}

function makeDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(y, m - 1, d)
  return date.getDate() === d ? date : null // rejects Feb 30
}

export function shootSubtitle(name: ShootName): string {
  const date = name.date?.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  return [name.context, date].filter(Boolean).join(" · ")
}
