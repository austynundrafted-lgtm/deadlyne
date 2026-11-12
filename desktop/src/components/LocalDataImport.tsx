import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { pickFolder } from "@/lib/platform"
import { importedSetting } from "@/lib/legacy-data"
import { settingsStore } from "@/lib/settings"
import { importLibraryData } from "@/lib/library"
import { importRecentShoots } from "@/lib/recents"
import { useCodes } from "@/lib/codes"
import { useExport } from "@/lib/export"
import { useFtp } from "@/lib/ftp"
import { loadSettings, useStore } from "@/store"
import { reloadIngestPrefs, useIngest } from "@/components/IngestDialog"
import { Button } from "@/components/ui/button"

export function LocalDataImport() {
  const [busy, setBusy] = useState(false)
  const ingesting = useIngest((s) => s.running)
  const exporting = useExport((s) => s.running)
  const working = useStore((s) => !!s.busy)
  const sending = useFtp((s) => s.jobs.some((j) => j.status === "sending" || j.status === "queued"))
  const run = async () => {
    setBusy(true)
    try {
      const path = await pickFolder("Choose the previous Deadlyne data folder")
      if (!path) return
      const result = await invoke<{ settings: Record<string, unknown>; library: unknown; copied: number; kept: number; errors: string[] }>("store_import_data", { path })
      let imported = result.copied, kept = result.kept
      for (const [key, raw] of Object.entries(result.settings)) {
        if (key === "recentShoots") { await importRecentShoots(raw); imported++; continue }
        const value = importedSetting(key, raw)
        if (value === undefined) continue
        if (await settingsStore.has(key)) { kept++; continue }
        await settingsStore.set(key, value)
        imported++
      }
      await settingsStore.save()
      await importLibraryData(result.library)
      await Promise.all([loadSettings(), reloadIngestPrefs(), useExport.getState().load(), useFtp.getState().load(), useCodes.getState().load()])
      if (result.errors.length) toast.error("Some setup data couldn’t be imported", { description: result.errors.slice(0, 4).join("\n"), duration: Infinity })
      else toast.success("Previous setup imported", { description: `${imported} setup items imported${kept ? `; ${kept} current choices kept` : ""}. Choose your shoot folders once to allow access.` })
    } catch (error) { toast.error("Couldn’t import the setup", { description: String(error) }) }
    finally { setBusy(false) }
  }
  return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-muted-foreground">Bring your setup from the previous Mac app into this version. Current choices are kept, library entries are merged, and originals stay in place.</p>
      <p className="text-sm text-muted-foreground">In your Library → Application Support folder, choose <span className="font-medium text-foreground">app.deadlyne.desktop</span> for library and preferences, or <span className="font-medium text-foreground">Deadlyne</span> for rosters and viewing records. Import both folders to bring over your full setup.</p>
      <Button variant="outline" disabled={busy || ingesting || exporting || working || sending} onClick={() => void run()}>{busy ? "Importing setup…" : "Import previous setup…"}</Button>
      <p className="text-xs text-muted-foreground">Passwords and sign-ins aren’t imported. Your photos and captions stay on your drives.</p>
    </div>
  )
}
