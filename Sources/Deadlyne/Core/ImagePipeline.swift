import AppKit
import ImageIO

/// Decodes and caches thumbnails and previews.
///
/// RAW files never go through a RAW converter: we decode the camera's embedded JPEG, letting
/// libjpeg's DCT scaling produce reduced sizes almost for free, then apply the RAW's EXIF
/// orientation ourselves (embedded previews are stored in sensor orientation).
final class ImagePipeline {
    static let shared = ImagePipeline()

    static let thumbnailPixels = 560

    private let thumbCache = NSCache<NSString, CGImage>()
    private let previewCache = NSCache<NSString, CGImage>()
    private let fullCache = NSCache<NSString, CGImage>()

    private let thumbQueue = OperationQueue()
    private let previewQueue = OperationQueue()
    private var thumbOps: [String: Operation] = [:]
    private var previewOps: [String: Operation] = [:]
    private var thumbWaiters: [String: [(CGImage?) -> Void]] = [:]
    private var previewWaiters: [String: [(CGImage?) -> Void]] = [:]
    private let lock = NSLock()

    private init() {
        let mem = Int(ProcessInfo.processInfo.physicalMemory)
        thumbCache.totalCostLimit = min(mem / 6, 3 << 30)
        previewCache.totalCostLimit = min(mem / 8, 1 << 30)
        fullCache.countLimit = 2
        let cores = ProcessInfo.processInfo.activeProcessorCount
        thumbQueue.maxConcurrentOperationCount = max(2, cores - 2)
        thumbQueue.qualityOfService = .userInitiated
        previewQueue.maxConcurrentOperationCount = 4
        previewQueue.qualityOfService = .userInteractive
    }

    // MARK: Thumbnails

    func cachedThumbnail(_ photo: Photo) -> CGImage? {
        thumbCache.object(forKey: photo.cacheKey as NSString)
    }

    /// Requests a thumbnail. `urgent` requests (visible cells) jump ahead of background warming.
    func thumbnail(for photo: Photo, urgent: Bool, completion: ((CGImage?) -> Void)? = nil) {
        let key = photo.cacheKey
        if let img = thumbCache.object(forKey: key as NSString) { completion?(img); return }
        lock.lock(); defer { lock.unlock() }
        if let completion { thumbWaiters[key, default: []].append(completion) }
        if let op = thumbOps[key] {
            if urgent, !op.isExecuting { op.queuePriority = .veryHigh }
            return
        }
        let op = BlockOperation { [weak self] in
            let img = ImagePipeline.render(photo, kind: .thumbnail, maxPixels: ImagePipeline.thumbnailPixels)
            self?.finish(key, img, cache: self?.thumbCache, ops: \.thumbOps, waiters: \.thumbWaiters)
        }
        op.queuePriority = urgent ? .veryHigh : .veryLow
        thumbOps[key] = op
        thumbQueue.addOperation(op)
    }

    /// Demotes a pending request (e.g. its cell scrolled off screen) so visible ones go first.
    func deprioritizeThumbnail(_ photo: Photo) {
        lock.lock(); defer { lock.unlock() }
        if let op = thumbOps[photo.cacheKey], !op.isExecuting { op.queuePriority = .low }
    }

    /// Warms every thumbnail in the background, like Photo Mechanic does after opening a folder.
    func warmThumbnails(_ photos: [Photo]) {
        for p in photos { thumbnail(for: p, urgent: false) }
    }

    func cancelAllThumbnails() {
        thumbQueue.cancelAllOperations()
        lock.lock()
        thumbOps.removeAll()
        thumbWaiters.removeAll()
        lock.unlock()
    }

    // MARK: Previews

    /// Screen-sized preview (fit to window). Cached so flipping back and forth is instant.
    func cachedPreview(_ photo: Photo) -> CGImage? {
        previewCache.object(forKey: photo.cacheKey as NSString)
    }

    func preview(for photo: Photo, maxPixels: Int, completion: ((CGImage?) -> Void)? = nil) {
        let key = photo.cacheKey
        if let img = previewCache.object(forKey: key as NSString) { completion?(img); return }
        lock.lock(); defer { lock.unlock() }
        if let completion { previewWaiters[key, default: []].append(completion) }
        if let op = previewOps[key] {
            if completion != nil, !op.isExecuting { op.queuePriority = .veryHigh }
            return
        }
        let op = BlockOperation { [weak self] in
            let img = ImagePipeline.render(photo, kind: .full, maxPixels: maxPixels)
            self?.finish(key, img, cache: self?.previewCache, ops: \.previewOps, waiters: \.previewWaiters)
        }
        op.queuePriority = completion != nil ? .veryHigh : .normal
        previewOps[key] = op
        previewQueue.addOperation(op)
    }

    /// Full-resolution decode for 100% zoom / focus checking.
    func fullResolution(for photo: Photo, completion: @escaping (CGImage?) -> Void) {
        let key = photo.cacheKey as NSString
        if let img = fullCache.object(forKey: key) { completion(img); return }
        DispatchQueue.global(qos: .userInteractive).async { [weak self] in
            let img = ImagePipeline.render(photo, kind: .full, maxPixels: nil)
            if let img { self?.fullCache.setObject(img, forKey: key) }
            DispatchQueue.main.async { completion(img) }
        }
    }

    private func finish(_ key: String, _ img: CGImage?, cache: NSCache<NSString, CGImage>?,
                        ops: ReferenceWritableKeyPath<ImagePipeline, [String: Operation]>,
                        waiters: ReferenceWritableKeyPath<ImagePipeline, [String: [(CGImage?) -> Void]]>) {
        if let img { cache?.setObject(img, forKey: key as NSString, cost: img.bytesPerRow * img.height) }
        lock.lock()
        self[keyPath: ops][key] = nil
        let callbacks = self[keyPath: waiters].removeValue(forKey: key) ?? []
        lock.unlock()
        guard !callbacks.isEmpty else { return }
        DispatchQueue.main.async { callbacks.forEach { $0(img) } }
    }

    // MARK: Decoding

    static func render(_ photo: Photo, kind: PreviewKind, maxPixels: Int?) -> CGImage? {
        if let raw = photo.raw {
            if let jpeg = PreviewExtractor.extract(from: raw, kind: kind),
               let src = CGImageSourceCreateWithData(jpeg as CFData, nil),
               let img = decode(src, maxPixels: maxPixels, applyTransform: false) {
                return oriented(img, photo.orientation)
            }
            // A camera JPEG shot alongside the RAW is the next-fastest source.
            if let jpegURL = photo.jpeg, let src = CGImageSourceCreateWithURL(jpegURL as CFURL, nil) {
                return decode(src, maxPixels: maxPixels, applyTransform: true)
            }
        }
        guard let src = CGImageSourceCreateWithURL(photo.primary as CFURL, nil) else { return nil }
        return decode(src, maxPixels: maxPixels, applyTransform: true)
    }

    private static func decode(_ src: CGImageSource, maxPixels: Int?, applyTransform: Bool) -> CGImage? {
        guard let maxPixels else {
            let opts: [CFString: Any] = [kCGImageSourceShouldCacheImmediately: true]
            guard let img = CGImageSourceCreateImageAtIndex(src, 0, opts as CFDictionary) else { return nil }
            if applyTransform,
               let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
               let o = props[kCGImagePropertyOrientation] as? Int {
                return oriented(img, o)
            }
            return img
        }
        // Big targets: let the JPEG decoder skip DCT coefficients (1/2, 1/4, 1/8 scale) instead of
        // decoding everything and resampling — ~3x faster for a screen-sized preview.
        if maxPixels > 1200, let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
           let w = props[kCGImagePropertyPixelWidth] as? Int, let h = props[kCGImagePropertyPixelHeight] as? Int {
            let longEdge = max(w, h)
            var factor = 1
            while factor < 8, Double(longEdge / (factor * 2)) >= Double(maxPixels) * 0.8 { factor *= 2 }
            let opts: [CFString: Any] = [kCGImageSourceShouldCacheImmediately: true, kCGImageSourceSubsampleFactor: factor]
            if let img = CGImageSourceCreateImageAtIndex(src, 0, opts as CFDictionary) {
                if applyTransform, let o = props[kCGImagePropertyOrientation] as? Int { return oriented(img, o) }
                return img
            }
        }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels,
            kCGImageSourceCreateThumbnailWithTransform: applyTransform,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
    }

    /// Applies an EXIF orientation (1–8) by redrawing into a correctly sized bitmap.
    static func oriented(_ img: CGImage, _ orientation: Int) -> CGImage {
        guard (2...8).contains(orientation) else { return img }
        let w = CGFloat(img.width), h = CGFloat(img.height)
        let swap = orientation >= 5
        let outW = swap ? h : w, outH = swap ? w : h
        guard let ctx = CGContext(data: nil, width: Int(outW), height: Int(outH), bitsPerComponent: 8,
                                  bytesPerRow: 0, space: img.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return img }
        ctx.interpolationQuality = .none
        switch orientation {
        case 2: ctx.translateBy(x: w, y: 0); ctx.scaleBy(x: -1, y: 1)
        case 3: ctx.translateBy(x: w, y: h); ctx.rotate(by: .pi)
        case 4: ctx.translateBy(x: 0, y: h); ctx.scaleBy(x: 1, y: -1)
        case 5: ctx.translateBy(x: 0, y: outH); ctx.scaleBy(x: 1, y: -1)
                ctx.translateBy(x: h, y: 0); ctx.rotate(by: .pi / 2)
        case 6: ctx.translateBy(x: 0, y: w); ctx.rotate(by: -.pi / 2)
        case 7: ctx.translateBy(x: 0, y: outH); ctx.scaleBy(x: 1, y: -1)
                ctx.translateBy(x: 0, y: w); ctx.rotate(by: -.pi / 2)
        case 8: ctx.translateBy(x: h, y: 0); ctx.rotate(by: .pi / 2)
        default: break
        }
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage() ?? img
    }
}
