import { useEffect, useId, useState } from "react"
import { Ellipsis, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import { useAuth } from "@/lib/auth"
import { presetOptions, type PresetKind, type PresetOptions, type WorkflowPreset } from "@/lib/preset-options"
import { confirm, promptName } from "@/lib/prompts"
import { deletePreset, refreshPresets, savePreset, usePresets } from "@/lib/workflow-presets"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function WorkflowPresets<K extends PresetKind>({ kind, current, onApply, active }: {
  kind: K
  current: PresetOptions[K]
  onApply: (options: PresetOptions[K]) => void
  active: boolean
}) {
  const labelId = useId()
  const { account, offline, bypassed, accountOperation } = useAuth(useShallow((s) => ({ account: s.account, offline: s.offline, bypassed: s.bypassed, accountOperation: s.accountOperation })))
  const { items, ownerId, loading, writing, error } = usePresets()
  const [selection, setSelection] = useState<WorkflowPreset | null>(null)
  const presets = ownerId === account?.id ? items.filter((p) => p.kind === kind) : []
  const selected = presets.some((p) => p.id === selection?.id) ? selection : null
  const fresh = selected && presets.some((p) => p.id === selected.id && p.version === selected.version)
  let unchanged = false
  try { unchanged = !!selected && !!fresh && JSON.stringify(presetOptions(kind, current)) === JSON.stringify(selected.settings) }
  catch { /* A partially typed naming pattern is not a saved preset. */ }
  const canWrite = !!account && !offline && !bypassed && !accountOperation && !writing

  useEffect(() => { if (active) void refreshPresets() }, [active])

  const act = async (work: () => Promise<void>) => {
    try { await work() }
    catch (e) { toast.error("Couldn’t change the preset", { description: e instanceof Error ? e.message : String(e) }) }
  }
  const save = () => act(async () => {
    const options = presetOptions(kind, current)
    const name = await promptName({ title: `Save ${kind} preset`, label: "Preset name", description: "Naming and options sync with your account. Folder locations stay on this device.", action: "Save preset" })
    if (!name) return
    const saved = await savePreset(kind, name, options)
    setSelection(saved)
    toast.success("Preset saved to your account")
  })

  return (
    <Field className="gap-2">
      <FieldLabel id={labelId}>Account preset</FieldLabel>
      <div className="flex min-w-0 items-center gap-2">
        <Select value={unchanged ? selected!.id : "__current"} onValueChange={(id) => {
          const preset = presets.find((p) => p.id === id)
          setSelection(preset ?? null)
          if (preset) onApply(presetOptions(kind, preset.settings))
        }}>
          <SelectTrigger aria-labelledby={labelId} className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__current">Current settings{selected && !unchanged ? " (edited)" : ""}</SelectItem>
            {presets.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" disabled={!canWrite} onClick={save}>Save preset…</Button>
        {selected && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" disabled={!canWrite} aria-label={`Manage ${selected.name} preset`}><Ellipsis /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => void act(async () => {
                setSelection(await savePreset(kind, selected.name, current, selected))
                toast.success("Preset updated on your account")
              })}>Update “{selected.name}”</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void act(async () => {
                const name = await promptName({ title: "Rename preset", label: "Preset name", initial: selected.name, action: "Rename" })
                if (name) setSelection(await savePreset(kind, name, selected.settings, selected))
              })}>Rename…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void act(async () => {
                if (!await confirm({ title: `Delete “${selected.name}”?`, description: "This removes the preset from your account and other devices when they next sync. Your current options and photography files stay.", action: "Delete preset", destructive: true })) return
                await deletePreset(selected)
                setSelection(null)
              })}>Delete preset…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button type="button" variant="ghost" size="icon-sm" disabled={loading || writing || offline || bypassed} onClick={() => void refreshPresets()} aria-label="Refresh account presets">
          <RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : undefined} />
        </Button>
      </div>
      <FieldDescription role={error ? "status" : undefined} className="text-xs">
        {bypassed ? "Sign in to save presets across devices." : error || (offline ? "Offline · saved presets are available. Connect to save changes." : "Presets follow your account between devices. Folder locations stay here.")}
      </FieldDescription>
    </Field>
  )
}
