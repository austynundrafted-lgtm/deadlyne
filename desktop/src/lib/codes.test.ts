import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
vi.mock("./settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }))

const { useCodes, expandCodes, expandLive, resolve } = await import("./codes")

describe("code replacements", () => {
  beforeEach(() => {
    useCodes.setState({ delimiter: "=", live: true, disabled: [] })
    useCodes.getState().replaceLists([
      { fileName: "a.txt", name: "Away", comments: [], rows: [["f10", "Jordan Sample (10)", "Fairborn Skyhawks", "quarterback"], ["ths", "Tecumseh High School"], ["empty"]] },
      { fileName: "b.txt", name: "Backup", comments: [], rows: [["f10", "Someone Else"]] },
    ])
  })

  it("expands columns, case-insensitively, and leaves unknown codes", () => {
    expect(expandCodes("=F10= (=f10#3=) of the =f10#2= vs =ths= and =zz9=")).toBe(
      "Jordan Sample (10) (quarterback) of the Fairborn Skyhawks vs Tecumseh High School and =zz9=",
    )
  })

  it("uses the file that sorts first when two share a code", () => {
    expect(resolve("f10")?.list).toBe("Away")
    expect(useCodes.getState().conflicts.get("f10")).toEqual(["Away", "Backup"])
  })

  it("leaves codes with nothing to expand to", () => {
    expect(expandCodes("=empty=")).toBe("=empty=")
  })

  it("expands as the closing delimiter is typed, keeping the caret", () => {
    const typed = "Pass from =f10="
    expect(expandLive(typed, typed.length)).toEqual({ value: "Pass from Jordan Sample (10)", caret: 28, hit: expect.objectContaining({ column: 1 }) })
    expect(expandLive("=nope=", 6)?.unknown).toBe("nope")
    expect(expandLive("=f10", 4)).toBeNull()
  })

  it("respects the delimiter and the live switch", () => {
    useCodes.setState({ delimiter: "\\" })
    expect(expandCodes("\\ths\\ = =ths=")).toBe("Tecumseh High School = =ths=")
    useCodes.setState({ live: false })
    expect(expandLive("\\ths\\", 5)).toBeNull()
  })
})
