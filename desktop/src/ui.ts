// Which dialogs are open. Kept apart from the photo store so opening one never re-renders the grid.
import { create } from "zustand"

type Dialog = "profile" | "ingest" | "send" | "ftpServers" | "shortcuts" | "export" | "deleteAccount" | "rename"

export type RenameWhich = "tagged" | "selected" | "all"

interface UIState {
  profile: boolean
  profileTab: "profile" | "account" | "data" | "catalog"
  deleteAccount: boolean
  ingest: boolean
  send: boolean
  ftpServers: boolean
  /** The keyboard shortcuts sheet (?). */
  shortcuts: boolean
  export: boolean
  rename: boolean
  /** What the rename dialog starts with. */
  renameWhich: RenameWhich
  /** What the send dialog starts with. */
  sendWhich: "tagged" | "selected"
  /** What the export dialog starts with. */
  exportWhich: "tagged" | "selected"
  /** Files waiting for "copy in or link?" before they join a folder. */
  addFiles: { folder: string; paths: string[] } | null
  open: (d: Dialog, on?: boolean) => void
  openAccount: () => void
  openSend: (which: "tagged" | "selected") => void
  openExport: (which: "tagged" | "selected") => void
  openRename: (which?: RenameWhich) => void
  openAddFiles: (folder: string, paths: string[]) => void
}

export const useUI = create<UIState>((set) => ({
  profile: false,
  profileTab: "profile",
  deleteAccount: false,
  ingest: false,
  send: false,
  ftpServers: false,
  shortcuts: false,
  export: false,
  rename: false,
  renameWhich: "selected",
  sendWhich: "tagged",
  exportWhich: "tagged",
  addFiles: null,
  open: (d, on = true) => set({ [d]: on, ...(d === "profile" && on ? { profileTab: "profile" as const } : {}) } as Partial<UIState>),
  openAccount: () => set({ profile: true, profileTab: "account" }),
  openSend: (sendWhich) => {
    // Leave any caption field first, so its edit is saved before the files go out.
    ;(document.activeElement as HTMLElement | null)?.blur()
    set({ send: true, sendWhich })
  },
  openExport: (exportWhich) => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    set({ export: true, exportWhich })
  },
  openRename: (renameWhich = "selected") => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    set({ rename: true, renameWhich })
  },
  openAddFiles: (folder, paths) => set({ addFiles: { folder, paths } }),
}))
