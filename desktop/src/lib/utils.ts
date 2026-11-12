import { createCn } from "cn/config"

// Teach the existing class merger which semantic text tokens are font sizes, so a
// compact control keeps its foreground color when its size variant is applied. The
// elevation shadows and face lighting from index.css are groups too, so a state or a
// caller's class replaces the one before it instead of leaving both to stylesheet order.
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "caption", "control"] }],
      shadow: [{ shadow: ["edge", "edge-hover", "plate", "plate-hover", "raised", "cap", "pressed", "well", "field", "field-focus", "thumb", "floating", "resume"] }],
      sheen: [{ sheen: ["raised", "cap", "pressed", "segment", "none"] }],
      tone: [{ tone: ["home", "photos", "codes"] }],
    },
  },
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

/**
 * A chosen segment lit in a workspace color: the raised segment takes the color as a tint and as
 * its ink (see `sheen-segment` in index.css). Pass one to a `ToggleGroupItem` or `TabsTrigger`.
 */
export const TONE = { home: "tone-home", photos: "tone-photos", codes: "tone-codes" } as const

/** The chosen item in a dialog's toggle row: lit in Photos amber, like the title-bar filters. */
export const CHOICE = TONE.photos
