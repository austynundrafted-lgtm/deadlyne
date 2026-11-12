import { createCn } from "cn/config"

// Teach the existing class merger which semantic text tokens are font sizes, so a
// compact control keeps its foreground color when its size variant is applied.
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["micro", "caption", "control"] }] } },
})

const TABBABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * A task dialog's `onOpenAutoFocus`: it opens with its enabled submit button in focus, so the
 * shortcut and Return runs the default action, as in a native dialog. With nothing to submit,
 * focus starts on the first control as usual.
 */
export function focusDefaultAction(event: Event) {
  const dialog = event.target as HTMLElement | null
  if (!dialog) return
  event.preventDefault()
  // What the dialog starts with (tagged or selected photos) settles in the frame after it opens.
  requestAnimationFrame(() => {
    // Gone already, or the photographer has moved to one of its controls: leave focus alone.
    const active = document.activeElement
    if (!dialog.isConnected || (active && active !== dialog && dialog.contains(active))) return
    const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]:not(:disabled)')
    ;(submit ?? dialog.querySelector<HTMLElement>(TABBABLE) ?? dialog).focus()
  })
}

/** The chosen item in a dialog's toggle row: a Photos-amber fill, like the title-bar filters. */
export const CHOICE = "text-muted-foreground data-[state=on]:border-(--workspace-photos)/60 data-[state=on]:bg-(--workspace-photos)/15 data-[state=on]:text-(--workspace-photos) data-[state=on]:hover:bg-(--workspace-photos)/20 data-[state=on]:hover:text-(--workspace-photos)"
