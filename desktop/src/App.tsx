import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { FileInput, FolderInput, Library } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { FILE_SCOPES } from "@/lib/api"
import { useCodes } from "@/lib/codes"
import { useDnd } from "@/lib/dnd"
import { folderTitle, useLibrary } from "@/lib/library"
import { followMovedFolder } from "@/lib/folders"
import { restoreAccess } from "@/lib/platform"
import { initViewing } from "@/lib/viewing"
import { initExport } from "@/lib/export"
import { initFtp } from "@/lib/ftp"
import { isIPad, plural, trashAction, trashName } from "@/lib/format"
import { useHotkeys } from "@/lib/hotkeys"
import { initMenu } from "@/lib/menu"
import { initOpening } from "@/lib/opening"
import { checkForUpdates } from "@/lib/updates"
import { loadSettings, targetPhotos, useStore } from "@/store"
import { useUI } from "@/ui"
import { AddFilesDialog } from "@/components/AddFilesDialog"
import { BadgesDialog } from "@/components/BadgesDialog"
import { FolderIcon } from "@/components/FolderIcon"
import { CodesView } from "@/components/CodesView"
import { ExportDialog } from "@/components/ExportDialog"
import { FtpServersDialog } from "@/components/FtpServersDialog"
import { HomeView } from "@/components/HomeView"
import { IngestDialog, initIngest } from "@/components/IngestDialog"
import { PhotosView } from "@/components/PhotosView"
import { ProfileDialog } from "@/components/ProfileDialog"
import { Prompts } from "@/components/Prompts"
import { SendDialog } from "@/components/SendDialog"
import { ShortcutsDialog } from "@/components/ShortcutsDialog"
import { TitleBar } from "@/components/TitleBar"
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
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

/** Documents a shoot can keep (mirrors DOC_EXTS in src-tauri/src/library.rs). */
const DOCUMENT = /\.(pdf|docx?|rtfd?|txt|md|tsv|xlsx?|numbers|pages|key|pptx?|odt|ods|odp)$/i

/** Files dropped on the window: rosters on Codes, documents into the open folder, else a shoot. */
function dropKind(paths: string[]): "rosters" | "documents" | "shoot" {
  const s = useStore.getState()
  if (s.workspace === "codes" && paths.every((p) => /\.(txt|csv|tsv|tab)$/i.test(p))) return "rosters"
  if (s.workspace !== "codes" && s.folder && paths.every((p) => DOCUMENT.test(p) || /\.csv$/i.test(p))) return "documents"
  return "shoot"
}

export default function App() {
  const workspace = useStore((s) => s.workspace)
  const [dropping, setDropping] = useState<null | "rosters" | "documents" | "shoot">(null)
  useHotkeys()

  useEffect(() => {
    loadSettings()
    // On iPad, reopen the folders picked in Files before anything reads them; follow any that moved.
    restoreAccess().then(async (moved) => {
      await useLibrary.getState().load()
      for (const [from, to] of moved) await followMovedFolder(from, to)
    })
    initViewing()
    useCodes.getState().load()
    initIngest()
    initFtp()
    initExport()
    initMenu()
    if (!isIPad) checkForUpdates({ quiet: true })
    // A shoot opened from Finder, the Dock or the command line comes up instead of Home.
    initOpening()
    // Rosters edited in a text editor (or by the Mac app) show up when you come back, and so do folder changes.
    const unfocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) return
      useCodes.getState().load()
      // Folders renamed, moved or unplugged while away show up as missing (or found again).
      useLibrary.getState().refreshStats()
    })
    // Drop a folder (or any photo in it) anywhere on the window to open it.
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter") setDropping(payload.paths.length ? dropKind(payload.paths) : "shoot")
      else if (payload.type !== "over") setDropping(null)
      if (payload.type !== "drop" || !payload.paths[0]) return
      // Rosters dropped on Codes are imported, documents join the open shoot, anything else opens as a shoot.
      const kind = dropKind(payload.paths)
      if (kind === "rosters") {
        invoke("import_code_lists", { paths: payload.paths }).then(() => useCodes.getState().load())
      } else if (kind === "documents") {
        useUI.getState().openAddFiles(useStore.getState().folder!, payload.paths)
      } else {
        useStore.getState().openFolder(payload.paths[0])
      }
    })
    return () => {
      unlisten.then((fn) => fn())
      unfocus.then((fn) => fn())
    }
  }, [])

  return (
    <TooltipProvider delayDuration={500}>
      <div
        className="flex h-full flex-col"
        onContextMenu={(e) => import.meta.env.PROD && !(e.target as HTMLElement).closest("input, textarea") && e.preventDefault()}
      >
        <TitleBar />
        <main className="relative min-h-0 flex-1">
          {/* Workspaces stay mounted so switching back keeps scroll position and selection. */}
          <div className="absolute inset-0" hidden={workspace !== "home"}>
            <HomeView />
          </div>
          <div className="absolute inset-0" hidden={workspace !== "photos"}>
            <PhotosView />
          </div>
          <div className="absolute inset-0" hidden={workspace !== "codes"}>
            <CodesView />
          </div>
          {dropping && (
            <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10 text-sm font-medium">
              {dropping === "documents" ? <FileInput className="mr-2 size-5" /> : <FolderInput className="mr-2 size-5" />}
              {dropping === "rosters"
                ? "Drop to import these rosters"
                : dropping === "documents"
                  ? `Drop to add to ${folderTitle(useStore.getState().folder!)}`
                  : "Drop to open this shoot"}
            </div>
          )}
        </main>
      </div>
      <IngestDialog />
      <ProfileDialog />
      <BadgesDialog />
      <SendDialog />
      <ExportDialog />
      <FtpServersDialog />
      <ShortcutsDialog />
      <ConfirmTrash />
      <AddFilesDialog />
      <Prompts />
      <DragGhost />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}

function ConfirmTrash() {
  const open = useUI((s) => s.confirmTrash)
  const { photos, selected, focus, loupe, fileScope, trash } = useStore(
    useShallow((s) => ({ photos: s.photos, selected: s.selected, focus: s.focus, loupe: s.loupe, fileScope: s.fileScope, trash: s.trash })),
  )
  const targets = open ? targetPhotos({ photos, selected, focus, loupe }) : []
  const scope = FILE_SCOPES.find((f) => f.value === fileScope)!.label
  return (
    <AlertDialog open={open} onOpenChange={(o) => useUI.getState().open("confirmTrash", o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move {plural(targets.length, "photo")} to {trashName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {fileScope === "both"
              ? `Their RAW, JPG and sidecar files go to ${trashName}.`
              : `Only the ${scope.replace(" only", "")} files go; the other half of each pair stays.`}{" "}
            You can put them back from {trashName}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => trash(targets)}>
            {trashAction}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** What's being dragged around the library, following the pointer. */
function DragGhost() {
  const { item, x, y, over } = useDnd()
  if (!item) return null
  return (
    <div
      className="pointer-events-none fixed z-[100] flex max-w-60 items-center gap-2 rounded-lg bg-popover px-2.5 py-1.5 text-[13px] shadow-lg shadow-black/40 ring-1 ring-white/10"
      style={{ left: x + 12, top: y + 10 }}
    >
      {item.kind === "shoot" ? <FolderIcon size={20} selected={!!over} /> : <Library className="size-4 text-muted-foreground" />}
      <span className="truncate">{item.label}</span>
    </div>
  )
}
