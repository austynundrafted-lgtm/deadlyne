// Confirmation is separate from rendering so every destructive action can require it before
// mutating data. A second shortcut/menu event cannot replace a pending decision.
import { create } from "zustand"

export interface ConfirmOptions {
  title: string
  description: string
  action: string
  destructive?: boolean
}
export interface PromptOptions {
  title: string
  description?: string
  label: string
  initial?: string
  action: string
}
export type Confirmation = ConfirmOptions & { resolve: (ok: boolean) => void }
export type NamePrompt = PromptOptions & { resolve: (value: string | null) => void }

export const usePrompts = create<{ confirm: Confirmation | null; prompt: NamePrompt | null }>(() => ({ confirm: null, prompt: null }))

export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (usePrompts.getState().confirm || usePrompts.getState().prompt) return Promise.resolve(false)
  return new Promise((resolve) => usePrompts.setState({ confirm: { ...options, resolve } }))
}

export function promptName(options: PromptOptions): Promise<string | null> {
  if (usePrompts.getState().confirm || usePrompts.getState().prompt) return Promise.resolve(null)
  return new Promise((resolve) => usePrompts.setState({ prompt: { ...options, resolve } }))
}

export function answerConfirmation(request: Confirmation, ok: boolean) {
  if (usePrompts.getState().confirm !== request) return
  usePrompts.setState({ confirm: null })
  request.resolve(ok)
}

export function answerName(request: NamePrompt, value: string | null) {
  if (usePrompts.getState().prompt !== request) return
  usePrompts.setState({ prompt: null })
  request.resolve(value)
}

export function cancelPrompts() {
  const { confirm: c, prompt: p } = usePrompts.getState()
  if (c) answerConfirmation(c, false)
  if (p) answerName(p, null)
}
