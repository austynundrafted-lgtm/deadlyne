import { afterEach, describe, expect, it } from "vitest"
import { answerConfirmation, cancelPrompts, confirm, promptName, usePrompts } from "./prompts"

const options = { title: "Delete this photo?", description: "Move it to the Trash.", action: "Move to Trash", destructive: true }
afterEach(cancelPrompts)

describe("explicit confirmation", () => {
  it("waits for a decision and cancel means no", async () => {
    const pending = confirm(options)
    const request = usePrompts.getState().confirm!
    expect(request.title).toBe(options.title)
    answerConfirmation(request, false)
    expect(await pending).toBe(false)
    expect(usePrompts.getState().confirm).toBeNull()
  })

  it("rejects duplicate requests without replacing the original decision", async () => {
    const first = confirm(options)
    const request = usePrompts.getState().confirm!
    expect(await confirm({ ...options, title: "A different photo" })).toBe(false)
    expect(usePrompts.getState().confirm).toBe(request)
    answerConfirmation(request, true)
    expect(await first).toBe(true)
  })

  it("late close/approval events cannot affect the next confirmation", async () => {
    const first = confirm(options)
    const stale = usePrompts.getState().confirm!
    answerConfirmation(stale, false)
    await first
    const next = confirm({ ...options, title: "Next photo" })
    const current = usePrompts.getState().confirm!
    answerConfirmation(stale, true)
    expect(usePrompts.getState().confirm).toBe(current)
    answerConfirmation(current, false)
    expect(await next).toBe(false)
  })

  it("unmount cancels pending decisions and name prompts cannot overlap confirmation", async () => {
    const pending = confirm(options)
    expect(await promptName({ title: "New", label: "Name", action: "Create" })).toBeNull()
    cancelPrompts()
    expect(await pending).toBe(false)
  })
})
