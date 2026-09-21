// FTP servers: a newsroom, a wire service, a client's drop box. Saved once, picked when sending.
import { useEffect, useState } from "react"
import { CircleCheck, CircleX, Loader2, Plus, Server } from "lucide-react"
import { isMac } from "@/lib/format"
import { describeServer, hasPassword, IF_EXISTS, newServer, PROTOCOLS, testServer, useFtp, type FtpServer } from "@/lib/ftp"
import { cn } from "@/lib/utils"
import { useUI } from "@/ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

const keychainName = isMac ? "your Keychain" : "Windows Credential Manager"

export function FtpServersDialog() {
  const open = useUI((s) => s.ftpServers)
  const servers = useFtp((s) => s.servers)
  const [editing, setEditing] = useState<FtpServer | null>(null)

  // Adding the first server skips the empty list.
  useEffect(() => {
    if (open) setEditing(useFtp.getState().servers.length ? null : newServer())
  }, [open])

  const close = () => useUI.getState().open("ftpServers", false)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        {editing ? (
          <ServerForm
            key={editing.id}
            server={editing}
            isNew={!servers.some((s) => s.id === editing.id)}
            onDone={() => (servers.length || useFtp.getState().servers.length ? setEditing(null) : close())}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>FTP servers</DialogTitle>
              <DialogDescription>Where finished photos go: a newsroom, a wire service or a client.</DialogDescription>
            </DialogHeader>
            {servers.length ? (
              <ItemGroup className="gap-1">
                {servers.map((s) => (
                  <Item key={s.id} variant="outline" size="sm" className="cursor-pointer bg-card/40 hover:bg-card" onClick={() => setEditing(s)}>
                    <ItemMedia variant="icon">
                      <Server />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{s.name || s.host}</ItemTitle>
                      <ItemDescription>
                        {PROTOCOLS.find((p) => p.value === s.protocol)?.label} · {describeServer(s)}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Server />
                  </EmptyMedia>
                  <EmptyTitle>No servers yet</EmptyTitle>
                  <EmptyDescription>Add the FTP details your editor or wire service gave you.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent />
              </Empty>
            )}
            <DialogFooter>
              <Button variant="outline" className="sm:mr-auto" onClick={() => setEditing(newServer())}>
                <Plus data-icon="inline-start" /> Add server
              </Button>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

type TestState = { state: "idle" } | { state: "testing" } | { state: "ok" | "failed"; message: string }

function ServerForm({ server, isNew, onDone }: { server: FtpServer; isNew: boolean; onDone: () => void }) {
  const { saveServer, removeServer } = useFtp.getState()
  const [draft, setDraft] = useState(server)
  const [password, setPassword] = useState("")
  const [saved, setSaved] = useState(false)
  const [test, setTest] = useState<TestState>({ state: "idle" })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isNew) hasPassword(server.id).then(setSaved)
  }, [isNew, server.id])

  const update = (patch: Partial<FtpServer>) => {
    setDraft((d) => {
      const next = { ...d, ...patch }
      // Switching protocol moves the port along, unless it was set by hand.
      if (patch.protocol && PROTOCOLS.some((p) => p.port === d.port)) next.port = PROTOCOLS.find((p) => p.value === patch.protocol)!.port
      return next
    })
    setTest({ state: "idle" })
  }

  const clean = (): FtpServer => ({
    ...draft,
    name: draft.name.trim(),
    host: draft.host.trim().replace(/^s?ftps?:\/\//i, "").replace(/\/.*$/, ""),
    username: draft.username.trim(),
    remoteDir: draft.remoteDir.trim(),
  })

  const runTest = async () => {
    setTest({ state: "testing" })
    try {
      setTest({ state: "ok", message: await testServer(clean(), password || null) })
    } catch (e) {
      setTest({ state: "failed", message: String(e) })
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const s = clean()
      await saveServer({ ...s, name: s.name || s.host }, password ? password : null)
      onDone()
    } catch (err) {
      setTest({ state: "failed", message: String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save}>
      <DialogHeader>
        <DialogTitle>{isNew ? "Add an FTP server" : `Edit ${server.name || server.host}`}</DialogTitle>
        <DialogDescription>The password is saved in {keychainName}, not in Deadlyne’s settings.</DialogDescription>
      </DialogHeader>

      <FieldGroup className="mt-5 gap-4">
        <Field>
          <FieldLabel htmlFor="ftp-name">Name</FieldLabel>
          <Input id="ftp-name" autoFocus value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Dayton Daily wire" />
        </Field>
        <div className="grid grid-cols-[1fr_5.5rem] gap-3">
          <Field>
            <FieldLabel htmlFor="ftp-host">Server</FieldLabel>
            <Input id="ftp-host" value={draft.host} onChange={(e) => update({ host: e.target.value })} placeholder="ftp.example.com" spellCheck={false} autoCapitalize="off" />
          </Field>
          <Field>
            <FieldLabel htmlFor="ftp-port">Port</FieldLabel>
            <Input id="ftp-port" type="number" min={1} max={65535} value={draft.port} onChange={(e) => update({ port: Math.min(65535, Math.max(1, Number(e.target.value) || 21)) })} />
          </Field>
        </div>
        <Field>
          <FieldLabel>Connection</FieldLabel>
          <Select value={draft.protocol} onValueChange={(v) => update({ protocol: v as FtpServer["protocol"] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROTOCOLS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="ftp-user">Username</FieldLabel>
            <Input id="ftp-user" value={draft.username} onChange={(e) => update({ username: e.target.value })} spellCheck={false} autoCapitalize="off" autoComplete="off" />
          </Field>
          <Field>
            <FieldLabel htmlFor="ftp-password">Password</FieldLabel>
            <Input
              id="ftp-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setTest({ state: "idle" })
              }}
              placeholder={saved ? "Saved" : ""}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="ftp-dir">Folder on the server</FieldLabel>
          <Input id="ftp-dir" value={draft.remoteDir} onChange={(e) => update({ remoteDir: e.target.value })} placeholder="Leave empty for the folder you land in" spellCheck={false} />
          <FieldDescription className="text-xs">Missing folders are created when you send.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>If a photo with the same name is already there</FieldLabel>
          <Select value={draft.ifExists} onValueChange={(v) => update({ ifExists: v as FtpServer["ifExists"] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IF_EXISTS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription className="text-xs">
            {draft.ifExists === "replace"
              ? "Good for refiling a photo with a corrected caption."
              : "Camera file names repeat from game to game, so nothing on the server is replaced."}
          </FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Switch id="ftp-passive" checked={draft.passive} onCheckedChange={(v) => update({ passive: v })} />
          <FieldLabel htmlFor="ftp-passive">Passive mode</FieldLabel>
          <FieldDescription className="ml-auto text-xs">Leave on unless the server’s instructions say active.</FieldDescription>
        </Field>
      </FieldGroup>

      {test.state !== "idle" && (
        <p className={cn("mt-4 flex items-start gap-2 text-sm", test.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
          {test.state === "testing" ? (
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
          ) : test.state === "ok" ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-(--workspace-codes)" />
          ) : (
            <CircleX className="mt-0.5 size-4 shrink-0" />
          )}
          <span className="min-w-0 break-words">{test.state === "testing" ? "Connecting…" : test.message}</span>
        </p>
      )}

      <DialogFooter className="mt-6">
        {!isNew && (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive sm:mr-auto"
            onClick={async () => {
              await removeServer(server.id)
              onDone()
            }}
          >
            Remove
          </Button>
        )}
        <Button type="button" variant="outline" className={cn(isNew && "sm:mr-auto")} disabled={!draft.host.trim() || test.state === "testing"} onClick={runTest}>
          Test connection
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!draft.host.trim() || saving}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
