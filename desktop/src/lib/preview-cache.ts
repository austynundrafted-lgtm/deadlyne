// Keep a small window of decoded image elements alive. Fetching a neighbour's URL alone does
// not guarantee its full-size JPEG has been decoded when the photographer presses an arrow.
// Image bytes still go straight from the preview scheme to the browser, never through JS.
export interface PreviewSize { w: number; h: number }

interface Entry {
  image: HTMLImageElement
  promise: Promise<PreviewSize>
  ready?: PreviewSize
}

export class PreviewCache {
  private entries = new Map<string, Entry>()

  constructor(private createImage: () => HTMLImageElement = () => new Image()) {}

  peek(url: string): PreviewSize | undefined {
    return this.entries.get(url)?.ready
  }

  /** One request and one decode, even if navigation catches up with a pending prefetch. */
  load(url: string): Promise<PreviewSize> {
    const cached = this.entries.get(url)
    if (cached) return cached.promise
    const image = this.createImage()
    image.decoding = "async"
    image.src = url
    const entry: Entry = {
      image,
      promise: image.decode().then(() => {
        const size = { w: image.naturalWidth, h: image.naturalHeight }
        if (this.entries.get(url) === entry) entry.ready = size
        return size
      }).catch((error) => {
        if (this.entries.get(url) === entry) this.entries.delete(url)
        throw error
      }),
    }
    this.entries.set(url, entry)
    return entry.promise
  }

  /** Retain only the current photo and its immediate neighbours, including pending decodes. */
  retain(urls: readonly string[]) {
    const keep = new Set(urls)
    for (const [url, entry] of this.entries) {
      if (keep.has(url)) continue
      this.entries.delete(url)
      entry.image.removeAttribute("src") // cancel obsolete work during fast navigation
    }
  }

  clear() { this.retain([]) }
}
