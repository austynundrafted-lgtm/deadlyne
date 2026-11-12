import { describe, expect, it } from "vitest"
import { effectiveCatalogRule } from "./catalog-rules"

describe("catalog folder rules", () => {
  it("uses the closest ancestor and allows a child to override either rule", () => {
    const rules = { "/photos": "include", "/photos/private": "exclude", "/photos/private/approved": "include" } as const
    expect(effectiveCatalogRule("/photos/game", rules)?.rule).toBe("include")
    expect(effectiveCatalogRule("/photos/private/game", rules)?.rule).toBe("exclude")
    expect(effectiveCatalogRule("/photos/private/approved/game", rules)?.rule).toBe("include")
    expect(effectiveCatalogRule("/photos2", rules)).toBeNull()
  })
  it("handles root, trailing separators and Windows paths", () => {
    expect(effectiveCatalogRule("/photos", { "/": "exclude" })?.rule).toBe("exclude")
    expect(effectiveCatalogRule("C:\\Photos\\Game", { "C:\\Photos\\": "include" })?.rule).toBe("include")
  })
})
