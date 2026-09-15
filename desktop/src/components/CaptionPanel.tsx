// IPTC captions for the selected photos (or the photo in the loupe). Edits apply to every target
// and save when you leave a field. Codes like =f10= expand as you type; variables like {date}
// fill in per photo when saved.
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, CircleHelp, Settings2, UserRound, X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { FIELD_LABELS, JPEG_MODES, type CaptionField, type JpegMode } from "@/lib/api"
import { expandLive, useCodes } from "@/lib/codes"
import { mod, plural } from "@/lib/format"
import { pref, setPref } from "@/lib/settings"
import { VARIABLES } from "@/lib/variables"
import { cn } from "@/lib/utils"
import { commonCaption, targetPhotos, useStore } from "@/store"
import { useUI } from "@/ui"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

export const CAPTION_PANEL_WIDTH = 340

export function CaptionPanel() {
  const { photos, selected, focus, loupe, setCaptionPanel, fillCredits, profile } = useStore(
    useShallow((s) => ({
      photos: s.photos,
      selected: s.selected,
      focus: s.focus,
      loupe: s.loupe,
      setCaptionPanel: s.setCaptionPanel,
      fillCredits: s.fillCredits,
      profile: s.profile,
    })),
  )
  const targets = useMemo(() => targetPhotos({ photos, selected, focus, loupe }), [photos, selected, focus, loupe])
  const disabled = targets.length === 0
  const subtitle =
    targets.length === 0 ? "Select photos to caption" : targets.length === 1 ? targets[0].name : `${plural(targets.length, "photo")} — edits apply to all`

  return (
    <aside className="flex h-full shrink-0 flex-col border-l bg-panel" style={{ width: CAPTION_PANEL_WIDTH }}>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Caption</div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
        <HelpPopover />
        <JpegModePopover />
        <Button variant="ghost" size="icon-sm" aria-label={`Hide captions (${mod}I)`} onClick={() => setCaptionPanel(false)}>
          <X />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          <CaptionInput field="headline" targets={targets} disabled={disabled} />
          <CaptionInput field="caption" targets={targets} disabled={disabled} multiline />
          <CaptionInput field="keywords" targets={targets} disabled={disabled} hint="Separate with commas. Keywords merge across photos." />

          <Section id="location" title="Event & location">
            <CaptionInput field="event" targets={targets} disabled={disabled} />
            <CaptionInput field="location" targets={targets} disabled={disabled} />
            <div className="grid grid-cols-2 gap-3">
              <CaptionInput field="city" targets={targets} disabled={disabled} />
              <CaptionInput field="state" targets={targets} disabled={disabled} />
            </div>
            <CaptionInput field="country" targets={targets} disabled={disabled} />
          </Section>

          <Section id="credits" title="Credits">
            <CaptionInput field="creator" targets={targets} disabled={disabled} />
            <CaptionInput field="credit" targets={targets} disabled={disabled} />
            <CaptionInput field="copyright" targets={targets} disabled={disabled} />
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => fillCredits() || useUI.getState().open("profile")}
            >
              <UserRound data-icon="inline-start" />
              {profile?.name ? "Fill from profile" : "Set up profile to fill credits"}
            </Button>
          </Section>
        </div>
      </ScrollArea>

      <CodeStatus />
    </aside>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => pref(`captionSection.${id}`, id === "credits"))
  return (
    <Collapsible
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        setPref(`captionSection.${id}`, o)
      }}
      className="flex flex-col gap-3 border-t pt-3"
    >
      <CollapsibleTrigger className="flex items-center justify-between text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground">
        {title}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3">{children}</CollapsibleContent>
    </Collapsible>
  )
}

interface InputProps {
  field: CaptionField
  targets: ReturnType<typeof targetPhotos>
  disabled: boolean
  multiline?: boolean
  hint?: string
}

function CaptionInput({ field, targets, disabled, multiline, hint }: InputProps) {
  const commitCaption = useStore((s) => s.commitCaption)
  const focusRequest = useStore((s) => s.captionFocusRequest)
  const shared = useMemo(() => commonCaption(targets, field), [targets, field])
  const [draft, setDraft] = useState<string | null>(null)
  const session = useRef<{ ids: string[]; original: string } | null>(null)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | null>(null)

  // ⌘↩ from the photos jumps straight into the caption.
  useEffect(() => {
    if (field === "caption" && focusRequest > 0) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [focusRequest, field])

  useEffect(() => {
    if (pendingCaret.current !== null && ref.current) {
      ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  })

  const commit = () => {
    const s = session.current
    session.current = null
    const value = draft
    setDraft(null)
    if (!s || value === null || value === s.original) return
    const removed =
      field === "keywords"
        ? s.original.split(",").map((k) => k.trim()).filter((k) => k && !value.toLowerCase().split(/[,;]/).map((x) => x.trim()).includes(k.toLowerCase()))
        : []
    commitCaption(field, value, removed, s.ids)
  }

  const props = {
    ref,
    id: `caption-${field}`,
    disabled,
    value: draft ?? shared.value,
    placeholder: shared.mixed ? (field === "keywords" ? "Some photos have other keywords" : "Multiple values") : "",
    spellCheck: field === "caption" || field === "headline",
    onFocus: () => {
      session.current = { ids: targets.map((t) => t.id), original: shared.value }
      setDraft(shared.value)
    },
    onBlur: commit,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const el = e.target
      const live = expandLive(el.value, el.selectionStart ?? el.value.length)
      if (live && live.value !== el.value) {
        pendingCaret.current = live.caret
        setDraft(live.value)
      } else {
        setDraft(el.value)
      }
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) || e.key === "Escape") {
        e.preventDefault()
        ref.current?.blur()
      }
    },
  }

  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={props.id} className="text-xs text-muted-foreground">
        {FIELD_LABELS[field]}
      </FieldLabel>
      {multiline ? <Textarea {...props} rows={5} className="min-h-28 resize-y" /> : <Input {...props} />}
      {hint && <FieldDescription className="text-xs">{hint}</FieldDescription>}
    </Field>
  )
}

function CodeStatus() {
  const { table, lists, disabled } = useCodes(useShallow((s) => ({ table: s.table, lists: s.lists, disabled: s.disabled })))
  const active = lists.filter((l) => !disabled.includes(l.fileName))
  return (
    <button
      className="flex h-9 shrink-0 items-center gap-2 border-t px-4 text-left text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      onClick={() => useStore.getState().setWorkspace("codes")}
      title="Manage lookup files in Codes"
    >
      <span className={cn("size-1.5 rounded-full", table.size ? "bg-(--workspace-codes)" : "bg-muted-foreground/40")} />
      <span className="truncate">
        {table.size ? `${plural(table.size, "code")} ready · ${active.map((l) => l.name).join(", ")}` : "No code replacements are on"}
      </span>
    </button>
  )
}

function HelpPopover() {
  const delimiter = useCodes((s) => s.delimiter)
  const d = delimiter
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="How codes and variables work">
          <CircleHelp />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        <p className="font-medium">Codes</p>
        <p className="mt-1 text-muted-foreground">
          Type <code className="text-(--workspace-codes)">{d}code{d}</code> and it becomes the text from your lookup file.
          Add <code className="text-(--workspace-codes)">#2</code> before the closing {d} for another column.
        </p>
        <p className="mt-3 font-medium">Variables</p>
        <p className="mt-1 text-muted-foreground">Filled in per photo when saved:</p>
        <p className="mt-1 font-mono text-xs leading-relaxed">{VARIABLES.join(" ")}</p>
        <p className="mt-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <Kbd>{mod}↩</Kbd> jump to caption · <Kbd>Esc</Kbd> back to photos · <Kbd>⌥{mod}C</Kbd>/<Kbd>⌥{mod}V</Kbd> copy/paste captions
        </p>
      </PopoverContent>
    </Popover>
  )
}

function JpegModePopover() {
  const { jpegMode, setJpegMode } = useStore(useShallow((s) => ({ jpegMode: s.jpegMode, setJpegMode: s.setJpegMode })))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Caption settings">
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <Field>
          <FieldLabel>Captions in JPG files</FieldLabel>
          <Select value={jpegMode} onValueChange={(v) => setJpegMode(v as JpegMode)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JPEG_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription className="text-xs">
            Legacy IPTC is the older format many wire services still read. RAW files always keep captions in their XMP sidecar.
          </FieldDescription>
        </Field>
      </PopoverContent>
    </Popover>
  )
}
