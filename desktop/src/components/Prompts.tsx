// One confirm dialog and one name prompt for the whole app, called like functions:
// `if (await confirm({...}))`, `const name = await promptName({...})`.
import { useEffect, useRef, useState } from "react"
import { answerConfirmation, answerName, cancelPrompts, usePrompts, type NamePrompt as NameRequest } from "@/lib/prompts"
export { confirm, promptName } from "@/lib/prompts"
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
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function Prompts() {
  const { confirm: c, prompt: p } = usePrompts()
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => () => cancelPrompts(), [])
  const close = (ok: boolean) => {
    if (c) answerConfirmation(c, ok)
  }
  return (
    <>
      <AlertDialog open={!!c} onOpenChange={(o) => !o && close(false)}>
        {c && (
          <AlertDialogContent onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus() }}>
            <AlertDialogHeader>
              <AlertDialogTitle>{c.title}</AlertDialogTitle>
              <AlertDialogDescription>{c.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel ref={cancel} onClick={() => close(false)}>Cancel</AlertDialogCancel>
              <AlertDialogAction variant={c.destructive ? "destructive" : "default"} onClick={() => close(true)}>
                {c.action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
      <NamePrompt prompt={p} />
    </>
  )
}

function NamePrompt({ prompt: p }: { prompt: NameRequest | null }) {
  const [value, setValue] = useState("")
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!p) return
    setValue(p.initial ?? "")
    // Select the name without its extension, like Finder.
    requestAnimationFrame(() => {
      const el = input.current
      if (!el) return
      el.focus()
      const dot = (p.initial ?? "").lastIndexOf(".")
      el.setSelectionRange(0, dot > 0 ? dot : el.value.length)
    })
  }, [p])
  const finish = (result: string | null) => {
    if (p) answerName(p, result)
  }
  const trimmed = value.trim()
  return (
    <Dialog open={!!p} onOpenChange={(o) => !o && finish(null)}>
      {p && (
        <DialogContent className="sm:max-w-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (trimmed) finish(trimmed)
            }}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>{p.title}</DialogTitle>
              {p.description && <DialogDescription>{p.description}</DialogDescription>}
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="prompt-name">{p.label}</FieldLabel>
              <Input id="prompt-name" ref={input} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => finish(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!trimmed}>
                {p.action}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  )
}
