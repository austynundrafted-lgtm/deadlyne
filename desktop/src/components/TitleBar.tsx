// The one bar at the top: workspace tabs on the left, the current shoot's controls on the right.
// On macOS it sits in the title bar beside the window buttons (titleBarStyle "Overlay").
import { Filter, FolderOpen, House, Images, MessageSquareText, MoreHorizontal, Search, TextCursorInput } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import logo from "@/assets/logo.png"
import { FILE_SCOPES, LABELS, type FileScope } from "@/lib/api"
import { isMac, labelColor, mod } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore, type Workspace } from "@/store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
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
import { askTrash, copyOrMove, openFolderDialog } from "@/lib/actions"
import { Input } from "@/components/ui/input"
import { useUI } from "@/ui"
import { shootName } from "@/lib/shootName"

const WORKSPACES: { value: Workspace; label: string; icon: typeof House; key: string }[] = [
  { value: "home", label: "Home", icon: House, key: "1" },
  { value: "photos", label: "Photos", icon: Images, key: "2" },
  { value: "codes", label: "Codes", icon: TextCursorInput, key: "3" },
]

export function TitleBar() {
  const { workspace, setWorkspace, folder } = useStore(
    useShallow((s) => ({ workspace: s.workspace, setWorkspace: s.setWorkspace, folder: s.folder })),
  )
  const folderName = folder ? shootName(folder.split(/[\\/]/).filter(Boolean).pop() ?? folder).title : undefined

  return (
    <header
      data-tauri-drag-region
      className="flex h-12 shrink-0 items-center gap-3 border-b bg-bar pr-3"
      style={{ paddingLeft: isMac ? 92 : 12 }}
    >
      <img src={logo} alt="" className="pointer-events-none size-6" draggable={false} />

      <Tabs value={workspace} onValueChange={(v) => setWorkspace(v as Workspace)}>
        <TabsList className="h-9 bg-black/40 p-1">
          {WORKSPACES.map(({ value, label, icon: Icon, key }) => (
            <Tooltip key={value}>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value={value}
                  className="h-7 gap-1.5 px-3 aria-selected:border-transparent aria-selected:bg-(--tab) aria-selected:text-(--tab-fg) aria-selected:shadow-sm aria-selected:hover:text-(--tab-fg)"
                  style={{
                    ["--tab" as string]: `var(--workspace-${value})`,
                    ["--tab-fg" as string]: value === "home" ? "#fff" : "#111",
                  }}
                >
                  <Icon />
                  {label}
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {label} <Kbd>{mod}{key}</Kbd>
              </TooltipContent>
            </Tooltip>
          ))}
        </TabsList>
      </Tabs>

      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center justify-center">
        {workspace === "photos" && folderName && (
          <span data-tauri-drag-region className="truncate text-sm font-medium text-muted-foreground" title={folder!}>
            {folderName}
          </span>
        )}
      </div>

      {workspace === "photos" && folder && (
        <>
          <PhotoSearch />
          <PhotoFilters />
          <PhotoActions />
          <CaptionToggle />
        </>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" onClick={openFolderDialog}>
            <FolderOpen data-icon="inline-start" />
            Open
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
const ACTIVE = "text-muted-foreground data-[state=on]:bg-(--workspace-photos)/15 data-[state=on]:text-(--workspace-photos)"

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
  const extra = (minRating > 0 ? 1 : 0) + (labelFilter ? 1 : 0) + (fileScope !== "both" ? 1 : 0)

  return (
    <div className="flex items-center gap-1">
      <ToggleGroup
        type="single"
        size="sm"
        value={tagFilter}
        onValueChange={(v) => v && setFilter({ tagFilter: v as typeof tagFilter })}
      >
        <ToggleGroupItem value="all" className={ACTIVE}>All</ToggleGroupItem>
        <ToggleGroupItem value="tagged" className={ACTIVE}>Tagged</ToggleGroupItem>
        <ToggleGroupItem value="untagged" className={ACTIVE}>Untagged</ToggleGroupItem>
      </ToggleGroup>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Filter by rating or label">
            <Filter data-icon="inline-start" />
            Filter
            {extra > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{extra}</Badge>}
          </Button>
        </DropdownMenuTrigger>
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
              <DropdownMenuItem onSelect={() => { clearFilters(); setFilter({ fileScope: "both" }) }}>Clear filters</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** Searches file names, captions and keywords. ⌘F focuses it. */
function PhotoSearch() {
  const { search, setFilter } = useStore(useShallow((s) => ({ search: s.search, setFilter: s.setFilter })))
  return (
    <div className="relative w-44 shrink">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="photo-search"
        value={search}
        onChange={(e) => setFilter({ search: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Enter") e.currentTarget.blur()
        }}
        placeholder={`Search  ${mod}F`}
        className="h-7 pl-7 text-sm"
        aria-label="Search file names, captions and keywords"
      />
    </div>
  )
}

/** Everything you do to a batch of photos, in one menu. */
function PhotoActions() {
  const s = useStore.getState
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
        <TooltipContent>Copy, move, captions…</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={() => s().selectTagged()}>
          Select tagged <DropdownMenuShortcut>⇧{mod}T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => copyOrMove("tagged", false)}>
          Copy tagged to… <DropdownMenuShortcut>⇧{mod}C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyOrMove("tagged", true)}>
          Move tagged to… <DropdownMenuShortcut>⇧{mod}M</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyOrMove("selected", false)}>Copy selected to…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyOrMove("selected", true)}>Move selected to…</DropdownMenuItem>
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
        <DropdownMenuItem variant="destructive" onSelect={askTrash}>
          Move to Trash… <DropdownMenuShortcut>{mod}⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CaptionToggle() {
  const { captionPanel, setCaptionPanel } = useStore(useShallow((s) => ({ captionPanel: s.captionPanel, setCaptionPanel: s.setCaptionPanel })))
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={captionPanel}
          aria-label="Captions"
          className={cn(captionPanel && "bg-(--workspace-photos)/15 text-(--workspace-photos)")}
          onClick={() => setCaptionPanel(!captionPanel)}
        >
          <MessageSquareText />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Captions <Kbd>{mod}I</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}
