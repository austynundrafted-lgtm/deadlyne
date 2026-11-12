import { describe, expect, it } from "vitest"
import { importedSetting, mergeLibraryData, mergeRecentData } from "./legacy-data"

describe("moving existing setup into the sandbox", () => {
  it("merges library entries without replacing current organization or duplicating imports", () => {
    const current = { shoots: [{ path: "/game", addedAt: 1, openedAt: 3, favorite: true }], collections: [{ id: "team", name: "Current team", parent: null, shoots: ["/game"], createdAt: 1 }], links: [] }
    const old = { shoots: [{ path: "/game", addedAt: 0, openedAt: 2, favorite: false }, { path: "/other", addedAt: 0, openedAt: 2 }, { path: 42 }], collections: [{ id: "team", name: "Old team", parent: null, shoots: [], createdAt: 0 }], links: [{ id: "brief", path: "/brief.pdf", folder: "/other", addedAt: 1 }] }
    const merged = mergeLibraryData(current, old)
    expect(merged.shoots).toHaveLength(2)
    expect(merged.shoots[0].favorite).toBe(true)
    expect(merged.collections[0].name).toBe("Current team")
    expect(merged.links[0].path).toBe("/brief.pdf")
    expect(mergeLibraryData(merged, old)).toEqual(merged)
  })

  it("keeps current recents and excludes malformed rows", () => {
    const current = [{ path: "/game", name: "Current", photos: 200, openedAt: 3 }]
    expect(mergeRecentData(current, [{ path: "/game", name: "Old", photos: 10, openedAt: 1 }, { path: "/other", name: "Other", photos: 20, openedAt: 2 }, { path: "not-a-folder", name: "Bad" }])).toEqual([current[0], { path: "/other", name: "Other", photos: 20, openedAt: 2 }])
  })

  it("never imports account credentials/profile or passwords from setup files", () => {
    for (const key of ["profile", "deadlyne-auth", "accountPresets", "auth", "password"]) expect(importedSetting(key, "private")).toBeUndefined()
    const settings = importedSetting("ingest", { destination: "/jobs", job: "Friday", renameOn: true, password: "private", arbitrary: "ignored" })
    expect(settings).toEqual({ destination: "/jobs", job: "Friday", renameOn: true })
    const servers = importedSetting("ftpServers", [{ id: "server", name: "Desk", host: "example.invalid", port: 21, username: "fixture", remoteDir: "", protocol: "ftp", passive: true, ifExists: "rename", password: "private" }]) as object[]
    expect(servers[0]).not.toHaveProperty("password")
    expect(importedSetting("export", { files: "invalid", quality: 999, destination: 42 })).toEqual({})
  })
})
