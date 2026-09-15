// Codes: lookup files (rosters) on the left, the selected file as an editable table in the
// middle, and the delimiter plus a place to try codes on the right. Every edit saves itself.
import { useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { FileText, FolderOpen, Import, MoreHorizontal, Plus, Search, Trash2, TextCursorInput } from "lucide-react"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import { reveal } from "@/lib/api"
import { DELIMITERS, expandLive, resolve, useCodes, type CodeList } from "@/lib/codes"
import { plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

export function CodesView() {
  const { lists, disabled, loaded } = useCodes(useShallow((s) => ({ lists: s.lists, disabled: s.disabled, loaded: s.loaded })))
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const selected = lists.find((l) => l.fileName === selectedName) ?? lists[0] ?? null

  const importFiles = async (paths: string[]) => {
    const [imported, errors] = await invoke<[CodeList[], string[]]>("import_code_lists", { paths })
    const { replaceLists, lists: current, setColumnName } = useCodes.getState()
    replaceLists([...current, ...imported].sort((a, b) => a.fileName.localeCompare(b.fileName)))
    for (const l of imported) l.header?.forEach((name, i) => name && setColumnName(l.fileName, i + 1, name))
    if (imported[0]) setSelectedName(imported[0].fileName)
    if (imported.length) toast.success(`Imported ${imported.map((l) => l.name).join(", ")}`)
    if (errors.length) toast.error("Some files couldn’t be imported", { description: errors.join("\n") })
  }

  const newList = async () => {
    const fileName = await invoke<string>("create_code_list", { name: "Untitled Roster", rows: [] })
    await useCodes.getState().load()
    setSelectedName(fileName)
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-panel">
        <div className="px-4 pt-4 pb-2">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Lookup files</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {lists.length ? `${lists.length - lists.filter((l) => disabled.includes(l.fileName)).length} of ${lists.length} on` : "No files yet"}
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-0.5 px-2">
            {lists.map((l) => (
              <ListRow key={l.fileName} list={l} active={l.fileName === selected?.fileName} onSelect={() => setSelectedName(l.fileName)} />
            ))}
          </div>
        </ScrollArea>
        <div className="flex gap-1 border-t p-2">
          <Button variant="ghost" size="sm" onClick={newList}>
            <Plus data-icon="inline-start" /> New
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const picked = await openDialog({ multiple: true, title: "Import rosters", filters: [{ name: "Rosters", extensions: ["txt", "csv", "tsv", "tab"] }] })
              if (picked) importFiles(Array.isArray(picked) ? picked : [picked])
            }}
          >
            <Import data-icon="inline-start" /> Import…
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {!loaded ? null : selected ? (
          <Editor key={selected.fileName} list={selected} onRenamed={setSelectedName} />
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText />
              </EmptyMedia>
              <EmptyTitle>No lookup files yet</EmptyTitle>
              <EmptyDescription>
                A lookup file is a roster: a short code, then the full name, team and position. Make one before the game, then type codes while you caption.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={newList}>
                <Plus data-icon="inline-start" /> New lookup file
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </main>

      <Inspector />
    </div>
  )
}

function ListRow({ list, active, onSelect }: { list: CodeList; active: boolean; onSelect: () => void }) {
  const { enabled, setEnabled } = useCodes(useShallow((s) => ({ enabled: !s.disabled.includes(list.fileName), setEnabled: s.setEnabled })))
  const codes = list.rows.filter((r) => r[0]?.trim()).length
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cn(
        "flex cursor-default items-center gap-2.5 rounded-md border-l-2 border-transparent px-2 py-2 hover:bg-accent/50",
        active && "border-(--workspace-codes) bg-accent",
      )}
    >
      <Checkbox
        checked={enabled}
        onClick={(e) => e.stopPropagation()}
        onCheckedChange={(v) => setEnabled(list.fileName, v === true)}
        aria-label={`Use ${list.name} while captioning`}
      />
      <div className="min-w-0">
        <div className={cn("truncate text-sm font-medium", !enabled && "text-muted-foreground")}>{list.name}</div>
        <div className="text-xs text-muted-foreground">
          {plural(codes, "code")}
          {!enabled && " · off"}
        </div>
      </div>
    </div>
  )
}

function Editor({ list, onRenamed }: { list: CodeList; onRenamed: (fileName: string) => void }) {
  const { saveList, allColumnNames, conflicts, disabled, delimiter } = useCodes(
    useShallow((s) => ({ saveList: s.saveList, allColumnNames: s.columnNames, conflicts: s.conflicts, disabled: s.disabled, delimiter: s.delimiter })),
  )
  const columnNames = allColumnNames[list.fileName] ?? []
  const [query, setQuery] = useState("")
  const [asText, setAsText] = useState(false)
  const [confirmTrash, setConfirmTrash] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [prefix, setPrefix] = useState<string | null>(null)
  const columns = Math.max(3, ...list.rows.map((r) => r.length - 1))

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return list.rows.map((row, i) => ({ row, i })).filter(({ row }) => !q || row.some((c) => c.toLowerCase().includes(q)))
  }, [list.rows, query])

  const duplicates = useMemo(() => {
    const seen = new Set<string>()
    const dups = new Set<string>()
    for (const r of list.rows) {
      const c = r[0]?.trim().toLowerCase()
      if (c && seen.has(c)) dups.add(c)
      if (c) seen.add(c)
    }
    return dups
  }, [list.rows])

  const setCell = (rowIndex: number, col: number, value: string) => {
    const rows = list.rows.map((r) => [...r])
    while (rows[rowIndex].length <= col) rows[rowIndex].push("")
    rows[rowIndex][col] = value
    saveList({ ...list, rows })
  }

  const addRow = () => {
    setQuery("")
    saveList({ ...list, rows: [...list.rows, [""]] })
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-cell="${list.rows.length}-0"]`)?.focus())
  }

  const enabled = !disabled.includes(list.fileName)
  const shadowed = [...conflicts].filter(([, names]) => names.includes(list.name) && names[0] !== list.name).length
  const badCodes = list.rows.map((r) => r[0] ?? "").filter((c) => c.includes(delimiter) || /\s/.test(c))

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-bar px-4">
        {renaming !== null ? (
          <form
            className="flex-1"
            onSubmit={async (e) => {
              e.preventDefault()
              const name = renaming.trim()
              setRenaming(null)
              if (!name || name === list.name) return
              const fileName = await invoke<string>("rename_code_list", { fileName: list.fileName, newName: name })
              await useCodes.getState().load()
              onRenamed(fileName)
            }}
          >
            <Input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onBlur={(e) => e.currentTarget.form?.requestSubmit()} className="h-8 max-w-xs" />
          </form>
        ) : (
          <button className="min-w-0 truncate text-left text-sm font-semibold" onDoubleClick={() => setRenaming(list.name)} title="Double-click to rename">
            {list.name}
          </button>
        )}
        {renaming === null && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {plural(list.rows.filter((r) => r[0]?.trim()).length, "code")}
            {!enabled && " · off"}
          </span>
        )}
        <div className="flex-1" />
        {!asText && (
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search codes" className="h-8 w-44 pl-7" />
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={() => setAsText(!asText)}>
          <TextCursorInput data-icon="inline-start" /> {asText ? "Table" : "Text"}
        </Button>
        {!asText && (
          <Button size="sm" onClick={addRow}>
            <Plus data-icon="inline-start" /> Code
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => setRenaming(list.name)}>Rename…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPrefix("")}>
              Add prefix to every code…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => saveList({ ...list, rows: [...list.rows].sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? "", undefined, { numeric: true })) })}>
              Sort by code
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={async () => reveal(joinPath(await invoke<string>("code_lists_folder"), list.fileName))}>
              <FolderOpen /> Show file
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmTrash(true)}>
              <Trash2 /> Move to Trash…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {asText ? (
        <TextEditor list={list} />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-bar text-xs text-muted-foreground">
              <tr>
                <th className="w-28 border-r border-b px-3 py-2 text-left font-medium">Code</th>
                {Array.from({ length: columns }, (_, c) => (
                  <th key={c} className="border-r border-b px-3 py-2 text-left font-medium">
                    <HeaderName fileName={list.fileName} column={c + 1} name={columnNames[c] ?? ""} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row, i }) => {
                const code = row[0]?.trim().toLowerCase() ?? ""
                const dup = duplicates.has(code)
                const other = enabled && code && resolve(row[0].trim())?.list !== list.name
                return (
                  <tr key={i} className="group">
                    {Array.from({ length: columns + 1 }, (_, c) => (
                      <td key={c} className="border-r border-b p-0">
                        <input
                          data-cell={`${i}-${c}`}
                          value={row[c] ?? ""}
                          placeholder={c === 0 ? "code" : ""}
                          title={c === 0 && dup ? "Used more than once in this file — only the first line is used" : c === 0 && other ? "Also in another file, which wins" : undefined}
                          onChange={(e) => setCell(i, c, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") document.querySelector<HTMLInputElement>(`[data-cell="${i + 1}-${c}"]`)?.focus()
                            if (e.key === "Backspace" && c === 0 && !row.some(Boolean)) {
                              e.preventDefault()
                              saveList({ ...list, rows: list.rows.filter((_, k) => k !== i) })
                            }
                          }}
                          className={cn(
                            "h-8 w-full bg-transparent px-3 outline-none focus:bg-accent/60",
                            c === 0 && "font-mono font-semibold text-(--workspace-codes)",
                            c === 0 && other && "text-(--workspace-photos)",
                            c === 0 && dup && "text-destructive",
                          )}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Button variant="ghost" size="sm" className="m-2 text-muted-foreground" onClick={addRow}>
            <Plus data-icon="inline-start" /> Add a code
          </Button>
        </ScrollArea>
      )}

      <div className="flex h-8 shrink-0 items-center border-t bg-bar px-4 text-xs text-muted-foreground">
        {duplicates.size > 0 || shadowed > 0 || badCodes.length > 0 ? (
          <span className="truncate text-(--workspace-photos)">
            {[
              duplicates.size && `Used twice: ${[...duplicates].slice(0, 5).join(", ")}`,
              shadowed && `${plural(shadowed, "code")} also in another file that wins`,
              badCodes.length && `Codes can’t contain spaces or ${delimiter}: ${badCodes.slice(0, 3).join(", ")}`,
            ].filter(Boolean).join("   ·   ")}
          </span>
        ) : (
          <span>Saved automatically · Tab and Enter move between cells · Backspace in an empty row deletes it</span>
        )}
      </div>

      <Dialog open={prefix !== null} onOpenChange={(o) => !o && setPrefix(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add a prefix to every code</DialogTitle>
            <DialogDescription>Handy when both teams have a #10: prefix one roster with “f” and 10 becomes f10.</DialogDescription>
          </DialogHeader>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const p = prefix?.trim()
              if (p) saveList({ ...list, rows: list.rows.map((r) => (r[0] ? [p + r[0], ...r.slice(1)] : r)) })
              setPrefix(null)
            }}
          >
            <Input autoFocus value={prefix ?? ""} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. f" />
            <Button type="submit" disabled={!prefix?.trim()}>Add prefix</Button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmTrash} onOpenChange={setConfirmTrash}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move “{list.name}” to the Trash?</AlertDialogTitle>
            <AlertDialogDescription>Its codes stop working in captions. You can get the file back from the Trash.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                try {
                  await invoke("trash_code_list", { fileName: list.fileName })
                  toast.success(`Moved “${list.name}” to the Trash`)
                } catch (e) {
                  toast.error("Couldn’t move it to the Trash", { description: String(e) })
                }
                await useCodes.getState().load()
              }}
            >
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function HeaderName({ fileName, column, name }: { fileName: string; column: number; name: string }) {
  const setColumnName = useCodes((s) => s.setColumnName)
  return (
    <span className="flex items-center gap-1.5">
      <span>#{column}</span>
      <input
        defaultValue={name}
        key={name}
        placeholder={column === 1 ? "Name · default" : "name"}
        onBlur={(e) => e.target.value !== name && setColumnName(fileName, column, e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="min-w-0 flex-1 bg-transparent font-medium text-foreground/80 outline-none placeholder:text-muted-foreground/60 focus:text-foreground"
        aria-label={`Name column ${column}`}
      />
    </span>
  )
}

export function joinPath(dir: string, name: string) {
  return dir.includes("\\") ? `${dir}\\${name}` : `${dir}/${name}`
}

function toText(list: CodeList) {
  return [...list.comments, ...list.rows.map((r) => r.join("\t"))].join("\n")
}

function TextEditor({ list }: { list: CodeList }) {
  const saveList = useCodes((s) => s.saveList)
  const [text, setText] = useState(() => toText(list))
  return (
    <Textarea
      value={text}
      spellCheck={false}
      className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-sm [tab-size:24]"
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          e.preventDefault()
          const el = e.currentTarget
          const { selectionStart: a, selectionEnd: b } = el
          const next = text.slice(0, a) + "\t" + text.slice(b)
          setText(next)
          requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1))
        }
      }}
      onChange={(e) => {
        setText(e.target.value)
        const lines = e.target.value.split("\n")
        const comments = lines.filter((l) => l.trim().startsWith("#")).map((l) => l.trim())
        const rows = lines.filter((l) => l.trim() && !l.trim().startsWith("#")).map((l) => (l.includes("\t") ? l.split("\t").map((c) => c.trim()) : [l.trim()]))
        saveList({ ...list, comments, rows })
      }}
    />
  )
}

function Inspector() {
  const { delimiter, live, setDelimiter, setLive, table, lists, disabled, columnNames } = useCodes(
    useShallow((s) => ({ delimiter: s.delimiter, live: s.live, setDelimiter: s.setDelimiter, setLive: s.setLive, table: s.table, lists: s.lists, disabled: s.disabled, columnNames: s.columnNames })),
  )
  const d = delimiter
  const example = useMemo(() => {
    for (const l of lists.filter((x) => !disabled.includes(x.fileName))) {
      const row = [...l.rows].filter((r) => r[0]?.trim()).sort((a, b) => b.length - a.length)[0]
      if (row) return { code: row[0], values: row.slice(1), names: columnNames[l.fileName] ?? [] }
    }
    return { code: "L7", values: ["Luka Dončić", "Dallas Mavericks", "guard"], names: ["Name", "Team", "Position"] }
  }, [lists, disabled, columnNames])

  const [tryText, setTryText] = useState("")
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const tryRef = useRef<HTMLTextAreaElement>(null)
  const caret = useRef<number | null>(null)
  useEffect(() => {
    if (caret.current !== null) {
      tryRef.current?.setSelectionRange(caret.current, caret.current)
      caret.current = null
    }
  })

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-panel">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 p-4">
          <Field orientation="horizontal" className="justify-between">
            <FieldLabel>Delimiter</FieldLabel>
            <Select value={delimiter} onValueChange={setDelimiter}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIMITERS.map((x) => (
                  <SelectItem key={x.value} value={x.value}>
                    <span className="w-4 font-mono">{x.value}</span> {x.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal" className="justify-between">
            <FieldLabel htmlFor="codes-live">Expand as you type</FieldLabel>
            <Switch id="codes-live" checked={live} onCheckedChange={setLive} />
          </Field>

          <div>
            <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">How it works</div>
            <div className="flex flex-col gap-1.5 text-sm">
              {example.values.slice(0, 3).map((v, i) => (
                <div key={i} className="flex items-baseline gap-2" title={example.names[i] ? `#${i + 1} ${example.names[i]}` : `Column #${i + 1}`}>
                  <code className="shrink-0 font-semibold text-(--workspace-codes)">
                    {d}{example.code}{i ? `#${i + 1}` : ""}{d}
                  </code>
                  <span className="text-muted-foreground">→</span>
                  <span className="truncate">{v || "(empty)"}</span>
                </div>
              ))}
            </div>
            <FieldDescription className="mt-2 text-xs">
              Codes aren’t case-sensitive. Unknown codes stay as typed. When two files share a code, the file that sorts first wins.
            </FieldDescription>
          </div>

          <Field>
            <FieldLabel htmlFor="codes-try">Try it</FieldLabel>
            <Textarea
              id="codes-try"
              ref={tryRef}
              rows={4}
              value={tryText}
              placeholder={`${d}${example.code}${d} scores for ${d}${example.code}#2${d}`}
              onChange={(e) => {
                const el = e.target
                const r = expandLive(el.value, el.selectionStart ?? el.value.length, true)
                if (r && r.value !== el.value) {
                  caret.current = r.caret
                  setTryText(r.value)
                  setResult(r.hit ? { ok: true, text: `✓ ${d}${r.hit.token}${d} → “${r.hit.text}” · ${r.hit.list}, column #${r.hit.column}` } : { ok: true, text: "✓ Expanded the codes in the pasted text" })
                } else {
                  setTryText(el.value)
                  if (r?.unknown) setResult({ ok: false, text: `No active code “${r.unknown.split("#")[0]}”. Check the spelling or turn its file on.` })
                }
              }}
            />
            {result && <FieldDescription className={cn("text-xs", result.ok ? "text-(--workspace-codes)" : "text-(--workspace-photos)")}>{result.text}</FieldDescription>}
          </Field>

          <div>
            <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Active while captioning</div>
            <p className="text-sm text-muted-foreground">
              {table.size ? `${plural(table.size, "code")} from ${plural(lists.length - lists.filter((l) => disabled.includes(l.fileName)).length, "file")}` : "No lookup files are on."}
            </p>
          </div>
        </div>
      </ScrollArea>
      <Button variant="ghost" size="sm" className="m-2 justify-start text-muted-foreground" onClick={async () => reveal(await invoke<string>("code_lists_folder"))}>
        <FolderOpen data-icon="inline-start" /> Open lookup files folder
      </Button>
    </aside>
  )
}
