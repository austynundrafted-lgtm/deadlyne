// FTP delivery: saved servers, the send queue and its progress. The Rust side (src-tauri/src/ftp.rs)
// does the transfers; passwords go straight to the system keychain and never come back here.
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { toast } from "sonner"
import { create } from "zustand"
import type { Photo } from "@/lib/api"
import { plural } from "@/lib/format"
import { getSetting, setSetting } from "@/lib/settings"

export type FtpProtocol = "ftp" | "ftps" | "ftpsImplicit"
export type IfExists = "rename" | "replace" | "skip"
/** Which half of each RAW+JPEG pair to send. Wire services want the JPG. */
export type SendFiles = "jpeg" | "both" | "raw"

export interface FtpServer {
  id: string
  name: string
  protocol: FtpProtocol
  host: string
  port: number
  username: string
  remoteDir: string
  passive: boolean
  ifExists: IfExists
}

export const PROTOCOLS: { value: FtpProtocol; label: string; port: number }[] = [
  { value: "ftp", label: "FTP", port: 21 },
  { value: "ftps", label: "FTPS (explicit TLS)", port: 21 },
  { value: "ftpsImplicit", label: "FTPS (implicit TLS)", port: 990 },
]

export const IF_EXISTS: { value: IfExists; label: string }[] = [
  { value: "rename", label: "Send with a number added" },
  { value: "replace", label: "Replace it" },
  { value: "skip", label: "Skip it" },
]

export const SEND_FILES: { value: SendFiles; label: string }[] = [
  { value: "jpeg", label: "JPG" },
  { value: "both", label: "RAW + JPG" },
  { value: "raw", label: "RAW" },
]

export const newServer = (): FtpServer => ({
  id: crypto.randomUUID(),
  name: "",
  protocol: "ftp",
  host: "",
  port: 21,
  username: "",
  remoteDir: "",
  passive: true,
  ifExists: "rename",
})

export interface FtpProgress {
  jobId: string
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
  currentFile: string
  state: "connecting" | "sending" | "retrying"
  message: string | null
}

export interface FtpSummary {
  jobId: string
  sent: number
  skipped: number
  renamed: [string, string][]
  bytes: number
  errors: string[]
  cancelled: boolean
}

export interface SendJob {
  id: string
  server: FtpServer
  files: string[]
  photos: number
  status: "queued" | "sending" | "done" | "failed" | "stopped"
  progress: FtpProgress | null
  summary: FtpSummary | null
  started: number | null
}

/** The files to send for each photo. Sidecars travel with RAWs; JPGs already carry their captions. */
export function sendableFiles(photos: Photo[], files: SendFiles) {
  const out: string[] = []
  let missing = 0
  for (const p of photos) {
    const picked = files === "jpeg" ? [p.jpeg] : files === "raw" ? [p.raw, p.raw && p.sidecar] : [p.raw, p.jpeg, p.raw && p.sidecar]
    const real = picked.filter((f): f is string => !!f)
    if (!real.length || (files === "jpeg" && !p.jpeg) || (files === "raw" && !p.raw)) missing++
    out.push(...real)
  }
  return { files: out, missing }
}

export const describeServer = (s: FtpServer) => `${s.host || "no address"}${s.remoteDir.trim() ? `/${s.remoteDir.trim().replace(/^\/+/, "")}` : ""}`

interface FtpState {
  servers: FtpServer[]
  lastServer: string | null
  sendFiles: SendFiles
  jobs: SendJob[]
  load: () => Promise<void>
  saveServer: (server: FtpServer, password: string | null) => Promise<void>
  removeServer: (id: string) => Promise<void>
  setSendFiles: (f: SendFiles) => void
  send: (server: FtpServer, files: string[], photos: number) => void
  cancel: (jobId: string) => void
  clearFinished: () => void
}

export const useFtp = create<FtpState>((set, get) => ({
  servers: [],
  lastServer: null,
  sendFiles: "jpeg",
  jobs: [],

  load: async () => {
    const [servers, lastServer, sendFiles] = await Promise.all([
      getSetting<FtpServer[]>("ftpServers", []),
      getSetting<string | null>("ftpLastServer", null),
      getSetting<SendFiles>("ftpSendFiles", "jpeg"),
    ])
    set({ servers, lastServer, sendFiles })
  },

  saveServer: async (server, password) => {
    // The password goes first: if the keychain refuses it, nothing half-saved is left behind.
    if (password !== null) await setPassword(server.id, password)
    const servers = get().servers.some((s) => s.id === server.id)
      ? get().servers.map((s) => (s.id === server.id ? server : s))
      : [...get().servers, server]
    set({ servers })
    await setSetting("ftpServers", servers)
  },

  removeServer: async (id) => {
    const servers = get().servers.filter((s) => s.id !== id)
    set({ servers })
    await setSetting("ftpServers", servers)
    await setPassword(id, "").catch(() => {})
  },

  setSendFiles: (sendFiles) => {
    set({ sendFiles })
    setSetting("ftpSendFiles", sendFiles)
  },

  send: (server, files, photos) => {
    const job: SendJob = { id: crypto.randomUUID(), server, files, photos, status: "queued", progress: null, summary: null, started: null }
    set({ jobs: [...get().jobs, job], lastServer: server.id })
    setSetting("ftpLastServer", server.id)
    startNext()
  },

  cancel: (jobId) => {
    const job = get().jobs.find((j) => j.id === jobId)
    if (!job) return
    if (job.status === "queued") updateJob(jobId, { status: "stopped" })
    else if (job.status === "sending") invoke("ftp_cancel", { jobId })
  },

  clearFinished: () => set({ jobs: get().jobs.filter((j) => j.status === "queued" || j.status === "sending") }),
}))

export const setPassword = (id: string, password: string) => invoke("ftp_set_password", { id, password })
export const hasPassword = (id: string) => invoke<boolean>("ftp_has_password", { id })
export const testServer = (server: FtpServer, password: string | null) => invoke<string>("ftp_test", { server, password: password || null })

function updateJob(id: string, patch: Partial<SendJob>) {
  useFtp.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }))
}

/** Sends run one at a time, in the order they were queued. */
function startNext() {
  const { jobs } = useFtp.getState()
  if (jobs.some((j) => j.status === "sending")) return
  const next = jobs.find((j) => j.status === "queued")
  if (!next) return
  updateJob(next.id, { status: "sending", started: Date.now() })
  invoke("ftp_send", { job: { id: next.id, server: next.server, files: next.files } }).catch((e) => {
    finish({ jobId: next.id, sent: 0, skipped: 0, renamed: [], bytes: 0, errors: [String(e)], cancelled: false })
  })
}

function finish(summary: FtpSummary) {
  const job = useFtp.getState().jobs.find((j) => j.id === summary.jobId)
  const status: SendJob["status"] = summary.cancelled ? "stopped" : summary.errors.length ? "failed" : "done"
  updateJob(summary.jobId, { status, summary })
  if (job) {
    const to = job.server.name || job.server.host
    const sent = `${plural(summary.sent, "file")} sent to ${to}`
    const extras = [
      summary.skipped ? `${summary.skipped} already there, skipped` : "",
      summary.renamed.length ? `${summary.renamed.length} sent with a number added (${summary.renamed[0][1]}${summary.renamed.length > 1 ? "…" : ""})` : "",
    ].filter(Boolean)
    if (summary.cancelled) toast(`Stopped · ${sent}`)
    else if (summary.errors.length) toast.error(summary.sent ? `${sent}, with problems` : `Nothing was sent to ${to}`, { description: summary.errors.slice(0, 4).join("\n"), duration: Infinity })
    else toast.success(sent, { description: extras.join(" · ") || undefined })
  }
  startNext()
}

/** Wires transfer events once at launch. */
let wired = false

export async function initFtp() {
  if (wired) return
  wired = true
  await useFtp.getState().load()
  await listen<FtpProgress>("ftp-progress", (e) => updateJob(e.payload.jobId, { progress: e.payload }))
  await listen<FtpSummary>("ftp-done", (e) => finish(e.payload))
}
