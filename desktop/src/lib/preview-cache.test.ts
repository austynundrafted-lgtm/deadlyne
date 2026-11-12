import { describe, expect, it, vi } from "vitest"
import { PreviewCache } from "./preview-cache"

function fixture() {
  const images: {
    src: string; decoding: string; naturalWidth: number; naturalHeight: number;
    decode: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn>;
    ready: () => void; fail: () => void;
  }[] = []
  const cache = new PreviewCache(() => {
    let ready!: () => void
    let fail!: () => void
    const promise = new Promise<void>((resolve, reject) => { ready = resolve; fail = () => reject(new Error("decode failed")) })
    const image = { src: "", decoding: "", naturalWidth: 6000, naturalHeight: 4000, decode: vi.fn(() => promise), removeAttribute: vi.fn(), ready, fail }
    images.push(image)
    return image as unknown as HTMLImageElement
  })
  return { cache, images }
}

describe("decoded loupe previews", () => {
  it("shares pending work and immediately reuses a decoded neighbour", async () => {
    const { cache, images } = fixture()
    const first = cache.load("next")
    expect(cache.load("next")).toBe(first)
    expect(cache.peek("next")).toBeUndefined()
    images[0].ready()
    await first
    expect(cache.peek("next")).toEqual({ w: 6000, h: 4000 })
    await cache.load("next")
    expect(images).toHaveLength(1)
    expect(images[0].decode).toHaveBeenCalledOnce()
  })

  it("drops distant photos and cancels their obsolete requests during navigation", async () => {
    const { cache, images } = fixture()
    const old = cache.load("old")
    const current = cache.load("current")
    const next = cache.load("next")
    cache.retain(["current", "next", "new-neighbour"])
    expect(images[0].removeAttribute).toHaveBeenCalledWith("src")
    expect(images[1].removeAttribute).not.toHaveBeenCalled()
    images.forEach((image) => image.ready())
    await Promise.all([old, current, next])
    expect(cache.peek("old")).toBeUndefined()
    expect(cache.peek("current")).toBeDefined()
    cache.clear()
    expect(cache.peek("current")).toBeUndefined()
    expect(images[1].removeAttribute).toHaveBeenCalledWith("src")
  })

  it("allows a failed preview to retry", async () => {
    const { cache, images } = fixture()
    const first = cache.load("photo")
    images[0].fail()
    await expect(first).rejects.toThrow("decode failed")
    const retry = cache.load("photo")
    images[1].ready()
    await retry
    expect(cache.peek("photo")).toBeDefined()
    expect(images).toHaveLength(2)
  })

  it("a late failure from an abandoned request cannot remove its replacement", async () => {
    const { cache, images } = fixture()
    const old = cache.load("photo")
    cache.clear()
    const replacement = cache.load("photo")
    images[1].ready()
    await replacement
    images[0].fail()
    await expect(old).rejects.toThrow()
    expect(cache.peek("photo")).toEqual({ w: 6000, h: 4000 })
  })
})
