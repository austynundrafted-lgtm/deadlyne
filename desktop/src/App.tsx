import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { FolderInput } from "lucide-react"
import { useStore } from "@/store"
import { useHotkeys } from "@/lib/hotkeys"
import { checkForUpdates } from "@/lib/updates"
import { HomeView } from "@/components/HomeView"
import { PhotosView } from "@/components/PhotosView"
import { TitleBar } from "@/components/TitleBar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

export default function App() {
  const workspace = useStore((s) => s.workspace)
  const [dropping, setDropping] = useState(false)
  useHotkeys()

  useEffect(() => {
    checkForUpdates({ quiet: true })
    invoke<string | null>("launch_folder").then((path) => {
      if (path) useStore.getState().openFolder(path)
    })
    // Drop a folder (or any photo in it) anywhere on the window to open it.
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter" || payload.type === "over") setDropping(true)
      else setDropping(false)
      if (payload.type === "drop" && payload.paths[0]) useStore.getState().openFolder(payload.paths[0])
    })
    return () => void unlisten.then((fn) => fn())
  }, [])

  return (
    <TooltipProvider delayDuration={500}>
      <div className="flex h-full flex-col" onContextMenu={(e) => import.meta.env.PROD && e.preventDefault()}>
        <TitleBar />
        <main className="relative min-h-0 flex-1">
          {/* Both workspaces stay mounted so switching back keeps scroll position and selection. */}
          <div className="absolute inset-0" hidden={workspace !== "home"}>
            <HomeView />
          </div>
          <div className="absolute inset-0" hidden={workspace !== "photos"}>
            <PhotosView />
          </div>
          {dropping && (
            <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10 text-sm font-medium">
              <FolderInput className="mr-2 size-5" /> Drop to open this shoot
            </div>
          )}
        </main>
      </div>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}
