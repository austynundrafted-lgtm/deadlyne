// Which dialogs are open. Kept apart from the photo store so opening one never re-renders the grid.
import { create } from "zustand"

interface UIState {
  profile: boolean
  ingest: boolean
  badges: boolean
  /** A pending "Move to Trash" confirmation. */
  confirmTrash: boolean
  open: (d: "profile" | "ingest" | "badges" | "confirmTrash", on?: boolean) => void
}

export const useUI = create<UIState>((set) => ({
  profile: false,
  ingest: false,
  badges: false,
  confirmTrash: false,
  open: (d, on = true) => set({ [d]: on } as Partial<UIState>),
}))
