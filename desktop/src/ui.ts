// Which dialogs are open. Kept apart from the photo store so opening one never re-renders the grid.
import { create } from "zustand"

type Dialog = "profile" | "ingest" | "badges" | "confirmTrash" | "send" | "ftpServers"

interface UIState {
  profile: boolean
  ingest: boolean
  badges: boolean
  /** A pending "Move to Trash" confirmation. */
  confirmTrash: boolean
  send: boolean
  ftpServers: boolean
  /** What the send dialog starts with. */
  sendWhich: "tagged" | "selected"
  open: (d: Dialog, on?: boolean) => void
  openSend: (which: "tagged" | "selected") => void
}

export const useUI = create<UIState>((set) => ({
  profile: false,
  ingest: false,
  badges: false,
  confirmTrash: false,
  send: false,
  ftpServers: false,
  sendWhich: "tagged",
  open: (d, on = true) => set({ [d]: on } as Partial<UIState>),
  openSend: (sendWhich) => {
    // Leave any caption field first, so its edit is saved before the files go out.
    ;(document.activeElement as HTMLElement | null)?.blur()
    set({ send: true, sendWhich })
  },
}))
