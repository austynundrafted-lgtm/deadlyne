import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { FolderInput } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { FILE_SCOPES } from "@/lib/api"
import { useCodes } from "@/lib/codes"
import { plural } from "@/lib/format"
import { useHotkeys } from "@/lib/hotkeys"
import { checkForUpdates } from "@/lib/updates"
import { loadSettings, targetPhotos, useStore } from "@/store"
import { useUI } from "@/ui"
import { BadgesDialog } from "@/components/BadgesDialog"
import { CodesView } from "@/components/CodesView"
import { HomeView } from "@/components/HomeView"
import { IngestDialog, initIngest } from "@/components/IngestDialog"
import { PhotosView } from "@/components/PhotosView"
import { ProfileDialog } from "@/components/ProfileDialog"
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

export default function App() {
  const workspace = useStore((s) => s.workspace)
  const [dropping, setDropping] = useState(false)
  useHotkeys()

  useEffect(() => {
    loadSettings()
    useCodes.getState().load()
    initIngest()
    checkForUpdates({ quiet: true })
    invoke<string | null>("launch_folder").then((path) => {
      if (path) useStore.getState().openFolder(path)
    })
    // Rosters edited in a text editor (or by the Mac app) show up when you come back.
    const unfocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) useCodes.getState().load()
    })
    // Drop a folder (or any photo in it) anywhere on the window to open it.
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter" || payload.type === "over") setDropping(true)
      else setDropping(false)
      if (payload.type !== "drop" || !payload.paths[0]) return
      // Rosters dropped on Codes are imported; anything else opens as a shoot.
      if (useStore.getState().workspace === "codes" && payload.paths.every((p) => /\.(txt|csv|tsv|tab)$/i.test(p))) {
        invoke("import_code_lists", { paths: payload.paths }).then(() => useCodes.getState().load())
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
              <FolderInput className="mr-2 size-5" /> {workspace === "codes" ? "Drop to import these rosters" : "Drop to open this shoot"}
            </div>
          )}
        </main>
      </div>
      <IngestDialog />
      <ProfileDialog />
      <BadgesDialog />
      <ConfirmTrash />
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
          <AlertDialogTitle>Move {plural(targets.length, "photo")} to the Trash?</AlertDialogTitle>
          <AlertDialogDescription>
            {fileScope === "both"
              ? "Their RAW, JPG and sidecar files go to the Trash."
              : `Only the ${scope.replace(" only", "")} files go; the other half of each pair stays.`}{" "}
            You can put them back from the Trash.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => trash(targets)}>
            Move to Trash
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
