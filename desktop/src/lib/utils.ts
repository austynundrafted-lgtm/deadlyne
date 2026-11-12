import { createCn } from "cn/config"

// Teach the existing class merger which semantic text tokens are font sizes, so a
// compact control keeps its foreground color when its size variant is applied.
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["micro", "caption", "control"] }] } },
})

/** The chosen item in a dialog's toggle row: a Photos-amber fill, like the title-bar filters. */
export const CHOICE = "text-muted-foreground data-[state=on]:border-(--workspace-photos)/60 data-[state=on]:bg-(--workspace-photos)/15 data-[state=on]:text-(--workspace-photos) data-[state=on]:hover:bg-(--workspace-photos)/20 data-[state=on]:hover:text-(--workspace-photos)"
