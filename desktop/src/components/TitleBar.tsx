// The one bar at the top: workspace tabs on the left, the current shoot's controls on the right.
// On macOS it sits in the title bar beside the window buttons (titleBarStyle "Overlay").
import { Filter, FolderOpen, FolderOutput, House, Images, MessageSquareText, MoreHorizontal, Search, TextCursorInput, X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import logo from "@/assets/logo.png"
import { FILE_SCOPES, LABELS, type FileScope } from "@/lib/api"
import { isMac, labelColor, mod, openLabel, revealLabel, trashAction } from "@/lib/format"
import { cn, TONE } from "@/lib/utils"
import { useStore, type Workspace } from "@/store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { askTrash, copyOrMove, openExport, openFolderDialog, openTargets, revealTarget } from "@/lib/actions"
import { Input } from "@/components/ui/input"
import { useUI } from "@/ui"
import { SendQueue } from "@/components/SendDialog"

const WORKSPACES: { value: Workspace; label: string; icon: typeof House; key: string }[] = [
  { value: "home", label: "Home", icon: House, key: "1" },
  { value: "photos", label: "Photos", icon: Images, key: "2" },
  { value: "codes", label: "Codes", icon: TextCursorInput, key: "3" },
]

export function TitleBar() {
  const { workspace, setWorkspace, folder, librarySection, folderTab } = useStore(
    useShallow((s) => ({ workspace: s.workspace, setWorkspace: s.setWorkspace, folder: s.folder, librarySection: s.librarySection, folderTab: s.folderTab })),
  )
  // The culling controls belong to the contact sheet; documents and subfolders only need search.
  const inFolder = workspace === "photos" && !!folder && !librarySection
  const culling = inFolder && folderTab === "photos"

  return (
    <header
      data-tauri-drag-region
      className={cn("flex h-titlebar shrink-0 items-center gap-3 border-b surface-bar pr-3 pl-(--titlebar-inset)", isMac && "mac-titlebar")}
    >
      <img src={logo} alt="" className="pointer-events-none size-6" draggable={false} />

      <Tabs value={workspace} onValueChange={(v) => setWorkspace(v as Workspace)}>
        <TabsList aria-label="Workspaces">
          {WORKSPACES.map(({ value, label, icon: Icon, key }) => (
            <Tooltip key={value}>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value={value}
                  id={`workspace-tab-${value}`}
                  aria-controls={`workspace-${value}`}
                  aria-label={label}
                  className="gap-1.5 px-3 chosen:border-[color-mix(in_oklab,var(--tab)_58%,black)] chosen:bg-(--tab) chosen:text-(--tab-fg) chosen:sheen-cap chosen:shadow-cap chosen:hover:text-(--tab-fg)"
                  style={{
                    ["--tab" as string]: `var(--workspace-${value})`,
                    ["--tab-fg" as string]: "var(--workspace-foreground)",
                  }}
                >
                  <Icon />
                  <span className={cn(culling && "hidden min-[1100px]:inline")}>{label}</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {label} <Kbd>{mod}{key}</Kbd>
              </TooltipContent>
            </Tooltip>
          ))}
        </TabsList>
      </Tabs>

      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center justify-center" />

      {inFolder && <PhotoSearch placeholder={culling ? "Search" : folderTab === "documents" ? "Search documents" : "Search folders"} />}
      {culling && (
        <>
          <PhotoFilters />
          {/* What you do with the shoot sits together, the way the filters do. */}
          <div className="flex shrink-0 items-center gap-1">
            <ExportButton />
            <PhotoActions />
            <CaptionToggle />
          </div>
        </>
      )}

      <SendQueue />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="shrink-0" aria-label="Open a shoot" onClick={openFolderDialog}>
            <FolderOpen />
            {/* Beside a contact sheet's controls, a compact window keeps the icon and gives up the word (like Export and Captions). */}
            <span className={cn(culling && "hidden min-[1280px]:inline")}>Open</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Open a shoot <Kbd>{mod}O</Kbd>
        </TooltipContent>
      </Tooltip>
    </header>
  )
}

/** The chosen filter is lit in the Photos workspace color. */
const ACTIVE = TONE.photos

/** All / Tagged / Untagged, plus one menu for rating and label — instead of five controls. */
function PhotoFilters() {
  const { tagFilter, minRating, labelFilter, setFilter, clearFilters } = useStore(
    useShallow((s) => ({
      tagFilter: s.tagFilter,
      minRating: s.minRating,
      labelFilter: s.labelFilter,
      setFilter: s.setFilter,
      clearFilters: s.clearFilters,
    })),
  )
  const fileScope = useStore((s) => s.fileScope)
  const unviewedOnly = useStore((s) => s.unviewedOnly)
  const extra = (minRating > 0 ? 1 : 0) + (labelFilter ? 1 : 0) + (fileScope !== "both" ? 1 : 0) + (unviewedOnly ? 1 : 0)

  return (
    <div className="flex items-center gap-1">
      <ToggleGroup
        type="single"
        size="sm"
        value={tagFilter}
        onValueChange={(v) => v && setFilter({ tagFilter: v as typeof tagFilter })}
        aria-label="Show tagged or untagged photos"
        className="shrink-0"
      >
        <ToggleGroupItem value="all" className={ACTIVE}>All</ToggleGroupItem>
        <ToggleGroupItem value="tagged" className={ACTIVE}>Tagged</ToggleGroupItem>
        <ToggleGroupItem value="untagged" className={ACTIVE}>Untagged</ToggleGroupItem>
      </ToggleGroup>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0" aria-label={extra > 0 ? `Filter (${extra} active)` : "Filter"}>
                <Filter />
                <span className="hidden min-[1280px]:inline">Filter</span>
                {extra > 0 && <Badge className="h-4 min-w-4 px-1 text-micro">{extra}</Badge>}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Filter by rating, label, viewed or file type</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Rating</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(minRating)} onValueChange={(v) => setFilter({ minRating: Number(v) })}>
            <DropdownMenuRadioItem value="0">Any rating</DropdownMenuRadioItem>
            {[1, 2, 3, 4, 5].map((n) => (
              <DropdownMenuRadioItem key={n} value={String(n)}>
                {"★".repeat(n)}
                {n < 5 ? " or more" : ""}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Label</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={labelFilter ?? "any"}
            onValueChange={(v) => setFilter({ labelFilter: v === "any" ? null : (v as typeof labelFilter) })}
          >
            <DropdownMenuRadioItem value="any">Any label</DropdownMenuRadioItem>
            {LABELS.map((l) => (
              <DropdownMenuRadioItem key={l} value={l}>
                <span className="size-2.5 rounded-full" style={{ background: labelColor(l) }} />
                {l}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Review</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={unviewedOnly} onCheckedChange={(v) => useStore.getState().setUnviewedOnly(v === true)}>
            Show unviewed only
            <DropdownMenuShortcut>⌥{mod}U</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Files</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={fileScope} onValueChange={(v) => setFilter({ fileScope: v as FileScope })}>
            {FILE_SCOPES.map((f, i) => (
              <DropdownMenuRadioItem key={f.value} value={f.value}>
                {f.label}
                <DropdownMenuShortcut>⌥{mod}{i + 4}</DropdownMenuShortcut>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {extra > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={clearFilters}>Clear filters</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** Searches file names, captions and keywords (or document and folder names). ⌘F focuses it. */
function PhotoSearch({ placeholder }: { placeholder: string }) {
  const { search, setFilter } = useStore(useShallow((s) => ({ search: s.search, setFilter: s.setFilter })))
  return (
    <div className="relative min-w-24 w-44 shrink">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="photo-search"
        value={search}
        onChange={(e) => setFilter({ search: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            if (search) setFilter({ search: "" })
            else e.currentTarget.blur()
          } else if (e.key === "Enter") e.currentTarget.blur()
        }}
        placeholder={`${placeholder}  ${mod}F`}
        className="h-7 pr-7 pl-7 text-sm"
        aria-label={placeholder === "Search" ? "Search file names, captions and keywords" : placeholder}
      />
      {search && (
        <Button
          variant="ghost"
          size="icon-xs"
          static
          className="absolute top-1/2 right-0.5 size-6 -translate-y-1/2"
          aria-label="Clear search"
          onClick={() => {
            setFilter({ search: "" })
            document.getElementById("photo-search")?.focus()
          }}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

/** Everything you do to a batch of photos, in one menu. */
function PhotoActions() {
  const s = useStore.getState
  const autoAdvance = useStore((st) => st.autoAdvance)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Photo actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Export, copy, move, send, captions…</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={() => s().selectTagged()}>
          Select tagged <DropdownMenuShortcut>⇧{mod}T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => s().deselectAll()}>
          Deselect all <DropdownMenuShortcut>{mod}D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={autoAdvance} onCheckedChange={(v) => s().setAutoAdvance(v === true)}>
          Auto-advance in loupe <DropdownMenuShortcut>⇧{mod}A</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openExport()}>
          Export… <DropdownMenuShortcut>⇧{mod}E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyOrMove("tagged", false)}>
          Copy tagged to… <DropdownMenuShortcut>⇧{mod}C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyOrMove("tagged", true)}>
          Move tagged to… <DropdownMenuShortcut>⇧{mod}M</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyOrMove("selected", false)}>Copy selected to…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyOrMove("selected", true)}>Move selected to…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => useUI.getState().openSend("tagged")}>
          Send tagged via FTP… <DropdownMenuShortcut>⇧{mod}U</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useUI.getState().openSend("selected")}>Send selected via FTP…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useUI.getState().open("ftpServers")}>FTP servers…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => s().copyCaptions()}>
          Copy caption info <DropdownMenuShortcut>⌥{mod}C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => s().pasteCaptions()}>
          Paste caption info <DropdownMenuShortcut>⌥{mod}V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => s().fillCredits() || useUI.getState().open("profile")}>
          Fill credits from profile <DropdownMenuShortcut>⌥{mod}P</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={revealTarget}>
          {revealLabel} <DropdownMenuShortcut>⇧{mod}R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openTargets}>
          {openLabel} <DropdownMenuShortcut>{mod}E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useUI.getState().open("shortcuts")}>
          Keyboard shortcuts <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={askTrash}>
          {trashAction}… <DropdownMenuShortcut>{mod}⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Delivery is one of the four jobs, so it gets its own button, not just a menu line. */
function ExportButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" className="shrink-0" aria-label="Export photos" onClick={() => openExport()}>
          <FolderOutput />
          <span className="hidden min-[1280px]:inline">Export</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Export the tagged photos or the selection <Kbd>⇧{mod}E</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

function CaptionToggle() {
  const { captionPanel, setCaptionPanel } = useStore(useShallow((s) => ({ captionPanel: s.captionPanel, setCaptionPanel: s.setCaptionPanel })))
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={captionPanel}
          aria-label="Captions"
          className={cn("shrink-0", captionPanel && "bg-(--workspace-photos)/12 text-(--workspace-photos) shadow-pressed hover:bg-(--workspace-photos)/16 hover:text-(--workspace-photos)")}
          onClick={() => setCaptionPanel(!captionPanel)}
        >
          <MessageSquareText />
          <span className="hidden min-[1280px]:inline">Captions</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Captions <Kbd>{mod}I</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}
