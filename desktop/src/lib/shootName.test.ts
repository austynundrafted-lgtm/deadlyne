import { describe, expect, it } from "vitest"
import { shootName, shootSubtitle } from "./shootName"

describe("shootName", () => {
  it("reads matchup folders like the Mac app", () => {
    const n = shootName("Boys_Varsity-Fairborn-vs-Tecumseh_082126")
    expect(n.title).toBe("Fairborn vs. Tecumseh")
    expect(n.context).toBe("Boys Varsity")
    expect(n.date?.getFullYear()).toBe(2026)
  })
  it("keeps other folders' grouping", () => {
    expect(shootName("Fairborn_TippCity_090426").title).toBe("Fairborn · Tipp City")
    expect(shootSubtitle(shootName("2026-09-12_Madison-Austin_Wedding"))).toContain("2026")
  })
})
