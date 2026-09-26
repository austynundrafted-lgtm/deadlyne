// Code replacements: type `=f10=` while captioning and it becomes the code's first expansion
// column; `=f10#2=` pulls column #2 (a team, a position…). Lookup files are managed by Rust
// (src-tauri/src/codes.rs); matching runs here so expansion is instant while typing.
import { invoke } from "@tauri-apps/api/core"
import { create } from "zustand"
import { getSetting, setSetting } from "./settings"

export interface CodeList {
  fileName: string
  name: string
  comments: string[]
  /** `row[0]` is the code; `row[1…]` are expansion columns #1, #2… */
  rows: string[][]
  header?: string[]
}

export interface Lookup {
  token: string
  code: string
  column: number
  text: string
  list: string
}

export const DELIMITERS = [
  { value: "=", label: "equals" },
  { value: "\\", label: "backslash" },
  { value: ";", label: "semicolon" },
  { value: "~", label: "tilde" },
  { value: "`", label: "backtick" },
  { value: "|", label: "bar" },
  { value: "^", label: "caret" },
]

const MAX_CODE = 48

interface CodesState {
  loaded: boolean
  lists: CodeList[]
  /** File names of lookup files that are switched off. */
  disabled: string[]
  delimiter: string
  live: boolean
  /** File name → names of its expansion columns ("Name", "Team"…). */
  columnNames: Record<string, string[]>
  /** Lower-cased code → expansion columns and the file it came from (active files only). */
  table: Map<string, { values: string[]; list: string }>
  /** Codes defined by more than one active file → the files' names. */
  conflicts: Map<string, string[]>

  load: () => Promise<void>
  setDelimiter: (d: string) => void
  setLive: (on: boolean) => void
  setEnabled: (fileName: string, on: boolean) => void
  /** Turns every other lookup file off, e.g. just this game's two rosters. */
  useOnly: (fileNames: string[]) => void
  setColumnName: (fileName: string, column: number, name: string) => void
  saveList: (list: CodeList) => void
  replaceLists: (lists: CodeList[]) => void
}

function buildTable(lists: CodeList[], disabled: string[]) {
  const table = new Map<string, { values: string[]; list: string }>()
  const owners = new Map<string, string[]>()
  for (const list of lists) {
    if (disabled.includes(list.fileName)) continue
    const seen = new Set<string>()
    for (const row of list.rows) {
      const code = (row[0] ?? "").trim().toLowerCase()
      if (!code || seen.has(code)) continue
      seen.add(code)
      owners.set(code, [...(owners.get(code) ?? []), list.name])
      if (!table.has(code)) table.set(code, { values: row.slice(1), list: list.name })
    }
  }
  return { table, conflicts: new Map([...owners].filter(([, names]) => names.length > 1)) }
}

export const useCodes = create<CodesState>((set, get) => {
  const rebuild = (patch: Partial<CodesState>) => {
    const next = { ...get(), ...patch }
    set({ ...patch, ...buildTable(next.lists, next.disabled) })
  }
  const saveTimers = new Map<string, number>()

  return {
    loaded: false,
    lists: [],
    disabled: [],
    delimiter: "=",
    live: true,
    columnNames: {},
    table: new Map(),
    conflicts: new Map(),

    load: async () => {
      const [lists, disabled, delimiter, live, columnNames] = await Promise.all([
        invoke<CodeList[]>("code_lists"),
        getSetting<string[]>("codeListsDisabled", []),
        getSetting("codeDelimiter", "="),
        getSetting("codeExpandWhileTyping", true),
        getSetting<Record<string, string[]>>("codeColumnNames", { "Sample Roster.txt": ["Name", "Team", "Position"] }),
      ])
      rebuild({ loaded: true, lists, disabled, delimiter, live, columnNames })
    },

    setDelimiter: (delimiter) => {
      set({ delimiter })
      setSetting("codeDelimiter", delimiter)
    },
    setLive: (live) => {
      set({ live })
      setSetting("codeExpandWhileTyping", live)
    },
    setEnabled: (fileName, on) => {
      const disabled = on ? get().disabled.filter((f) => f !== fileName) : [...new Set([...get().disabled, fileName])]
      rebuild({ disabled })
      setSetting("codeListsDisabled", disabled)
    },
    useOnly: (fileNames) => {
      const disabled = get().lists.map((l) => l.fileName).filter((f) => !fileNames.includes(f))
      rebuild({ disabled })
      setSetting("codeListsDisabled", disabled)
    },
    setColumnName: (fileName, column, name) => {
      const names = [...(get().columnNames[fileName] ?? [])]
      while (names.length < column) names.push("")
      names[column - 1] = name.trim()
      while (names.length && !names[names.length - 1]) names.pop()
      const columnNames = { ...get().columnNames, [fileName]: names }
      set({ columnNames })
      setSetting("codeColumnNames", columnNames)
    },
    /** Updates a list in memory now and saves it to disk a moment later (edits come fast). */
    saveList: (list) => {
      rebuild({ lists: get().lists.map((l) => (l.fileName === list.fileName ? list : l)) })
      window.clearTimeout(saveTimers.get(list.fileName))
      saveTimers.set(
        list.fileName,
        window.setTimeout(() => {
          invoke("save_code_list", { fileName: list.fileName, comments: list.comments, rows: list.rows })
        }, 300),
      )
    },
    replaceLists: (lists) => rebuild({ lists }),
  }
})

// MARK: - Matching

/** `L7` → column #1 of L7; `L7#2` → column #2. Codes aren't case-sensitive. */
export function resolve(token: string): Lookup | null {
  const { table } = useCodes.getState()
  if (!token) return null
  const hash = token.lastIndexOf("#")
  if (hash > 0 && /^\d+$/.test(token.slice(hash + 1))) {
    const column = Number(token.slice(hash + 1))
    const hit = table.get(token.slice(0, hash).toLowerCase())
    if (column >= 1 && hit && hit.values.length) {
      return { token, code: token.slice(0, hash), column, text: hit.values[column - 1] ?? "", list: hit.list }
    }
  }
  const hit = table.get(token.toLowerCase())
  // A code with nothing after it has nothing to expand to, so it stays as typed.
  if (!hit || !hit.values.length) return null
  return { token, code: token, column: 1, text: hit.values[0] ?? "", list: hit.list }
}

const isBreak = (c: string) => /\s/.test(c)

/** Expands every known `=code=` in `text`. Unknown codes are left as typed. */
export function expandCodes(text: string): string {
  const { delimiter: d, table } = useCodes.getState()
  if (!table.size || !text.includes(d)) return text
  let out = ""
  let last = 0
  let i = 0
  while (i < text.length) {
    if (text[i] !== d) {
      i++
      continue
    }
    let j = i + 1
    while (j < text.length && j - i <= MAX_CODE + 1 && text[j] !== d && !isBreak(text[j])) j++
    if (j >= text.length || text[j] !== d) {
      i++
      continue
    }
    const hit = j > i + 1 ? resolve(text.slice(i + 1, j)) : null
    if (hit) {
      out += text.slice(last, i) + hit.text
      i = j + 1
      last = i
    } else {
      i = j // the closing delimiter may open the next code
    }
  }
  return out + text.slice(last)
}

/** The `=token=` whose closing delimiter sits just before `end`, if any. */
export function candidateAt(text: string, end: number): string | null {
  const { delimiter: d } = useCodes.getState()
  if (end < 3 || text[end - 1] !== d) return null
  let k = end - 2
  while (k >= 0 && end - 2 - k < MAX_CODE && text[k] !== d && !isBreak(text[k])) k--
  return k >= 0 && k < end - 2 && text[k] === d ? text.slice(k + 1, end - 1) : null
}

export type LiveResult = { value: string; caret: number; hit?: Lookup; unknown?: string } | null

/**
 * For an input or textarea that just changed: expands codes before the caret (a typed closing
 * delimiter, or a paste). Returns the new value and caret, or null when nothing changed.
 */
export function expandLive(value: string, caret: number, force = false): LiveResult {
  const { live } = useCodes.getState()
  if (!force && !live) return null
  const before = value.slice(0, caret)
  const token = candidateAt(value, caret)
  const expanded = expandCodes(before)
  if (expanded === before) return token ? { value, caret, unknown: token } : null
  return {
    value: expanded + value.slice(caret),
    caret: expanded.length,
    hit: token ? (resolve(token) ?? undefined) : undefined,
  }
}
