// The one bar at the top: workspace tabs on the left, the current shoot's controls on the right.
// On macOS it sits in the title bar beside the window buttons (titleBarStyle "Overlay").
import { Filter, FolderOpen, House, Images } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import logo from "@/assets/logo.png"
import { LABELS } from "@/lib/api"
import { isMac, labelColor, mod } from "@/lib/format"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { openFolderDialog } from "@/lib/actions"

const WORKSPACES: { value: Workspace; label: string; icon: typeof House; key: string }[] = [
  { value: "home", label: "Home", icon: House, key: "1" },
  { value: "photos", label: "Photos", icon: Images, key: "2" },
]

export function TitleBar() {
  const { workspace, setWorkspace, folder } = useStore(
    useShallow((s) => ({ workspace: s.workspace, setWorkspace: s.setWorkspace, folder: s.folder })),
  )
  const folderName = folder?.split(/[\\/]/).filter(Boolean).pop()

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

      {workspace === "photos" && folder && <PhotoFilters />}

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
  const extra = (minRating > 0 ? 1 : 0) + (labelFilter ? 1 : 0)

  return (
    <div className="flex items-center gap-1">
      <ToggleGroup
        type="single"
        size="sm"
        value={tagFilter}
        onValueChange={(v) => v && setFilter({ tagFilter: v as typeof tagFilter })}
      >
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="tagged">Tagged</ToggleGroupItem>
        <ToggleGroupItem value="untagged">Untagged</ToggleGroupItem>
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
