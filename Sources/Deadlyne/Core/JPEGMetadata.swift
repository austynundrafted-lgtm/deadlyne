import Foundation
import ImageIO

/// How captions are written into JPG files (RAW files always use the XMP sidecar).
enum JPEGCaptionMode: Int, CaseIterable {
    case off, xmp, xmpAndIIM

    var title: String {
        switch self {
        case .off: return "Don’t write into JPGs"
        case .xmp: return "XMP only (modern)"
        case .xmpAndIIM: return "XMP + legacy IPTC"
        }
    }

    static var saved: JPEGCaptionMode {
        let d = UserDefaults.standard
        if let v = d.object(forKey: "jpegCaptionMode") as? Int, let m = JPEGCaptionMode(rawValue: v) { return m }
        // Earlier builds had an on/off checkbox.
        return d.object(forKey: "embedJPEG") as? Bool == false ? .off : .xmpAndIIM
    }

    func save() { UserDefaults.standard.set(rawValue, forKey: "jpegCaptionMode") }
}

/// Embeds captions directly inside JPEG files (so delivered JPEGs carry them) and reads them back.
///
/// Uses `CGImageDestinationCopyImageSource`, which rewrites only the metadata segments — the
/// compressed image data is copied byte-for-byte, never re-encoded. Legacy IPTC-IIM is then
/// added by `IPTCIIM`, which likewise touches only its own segment.
enum JPEGMetadata {
    enum WriteError: LocalizedError {
        case unreadable, cannotCreate, copyFailed(String), verifyFailed
        var errorDescription: String? {
            switch self {
            case .unreadable: return "the file couldn’t be read"
            case .cannotCreate: return "a temporary file couldn’t be created"
            case .copyFailed(let s): return "metadata couldn’t be written (\(s))"
            case .verifyFailed: return "the rewritten file didn’t verify, so the original was kept"
            }
        }
    }

    /// Writes `fields` as XMP. When `legacyIPTC` is true the IIM block is rewritten from the full
    /// `info`; when false, Deadlyne's fields are removed from any existing IIM block so older
    /// readers never see a stale caption.
    static func embed(_ info: IPTCInfo, fields: Set<IPTCField>, into url: URL, legacyIPTC: Bool) throws {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let type = CGImageSourceGetType(src),
              let before = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] else { throw WriteError.unreadable }
        let meta = CGImageMetadataCreateMutable()
        for f in IPTCField.allCases where fields.contains(f) {
            CGImageMetadataRegisterNamespaceForPrefix(meta, f.namespace as CFString, f.prefix as CFString, nil)
            let path = f.xmpPath as CFString
            let value = info[f]
            if value.isEmpty {
                CGImageMetadataSetValueWithPath(meta, nil, path, kCFNull)
                continue
            }
            let tag: CGImageMetadataTag?
            switch f.kind {
            case .simple:
                tag = CGImageMetadataTagCreate(f.namespace as CFString, f.prefix as CFString, f.name as CFString,
                                               .string, value as CFString)
            case .langAlt:
                // ImageIO only builds a proper rdf:Alt when addressed by language-qualified path.
                CGImageMetadataSetValueWithPath(meta, nil, "\(f.xmpPath)[x-default]" as CFString, value as CFString)
                tag = nil
            case .bag:
                tag = CGImageMetadataTagCreate(f.namespace as CFString, f.prefix as CFString, f.name as CFString,
                                               .arrayUnordered, info.keywords as CFArray)
            case .seq:
                let items = value.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
                tag = CGImageMetadataTagCreate(f.namespace as CFString, f.prefix as CFString, f.name as CFString,
                                               .arrayOrdered, items as CFArray)
            }
            if let tag { CGImageMetadataSetTagWithPath(meta, nil, path, tag) }
        }

        let tmp = url.deletingLastPathComponent().appendingPathComponent(".deadlyne-\(UUID().uuidString).\(url.pathExtension)")
        guard let dest = CGImageDestinationCreateWithURL(tmp as CFURL, type, 1, nil) else { throw WriteError.cannotCreate }
        let opts: [CFString: Any] = [kCGImageDestinationMetadata: meta, kCGImageDestinationMergeMetadata: true]
        var err: Unmanaged<CFError>?
        guard CGImageDestinationCopyImageSource(dest, src, opts as CFDictionary, &err) else {
            try? FileManager.default.removeItem(at: tmp)
            throw WriteError.copyFailed(err.map { String(describing: $0.takeRetainedValue()) } ?? "unknown")
        }
        if (type as String) == "public.jpeg" {
            do {
                // Preserve the legacy block from the original file: ImageIO's copy re-derives it
                // and misreads old charset-less text.
                let original = IPTCIIM.read(jpeg: try Data(contentsOf: url, options: .mappedIfSafe))
                let exif = before[kCGImagePropertyExifDictionary] as? [CFString: Any]
                let created = IPTCIIM.DateCreated(exifDateTime: exif?[kCGImagePropertyExifDateTimeOriginal] as? String,
                                                  offset: exif?[kCGImagePropertyExifOffsetTimeOriginal] as? String)
                let data = try Data(contentsOf: tmp)
                try IPTCIIM.rewrite(jpeg: data, info: legacyIPTC ? info : nil, existing: original,
                                    dateCreated: created).write(to: tmp)
            } catch {
                try? FileManager.default.removeItem(at: tmp)
                throw WriteError.copyFailed("legacy IPTC: \(error.localizedDescription)")
            }
        }
        // Verify the new file decodes to the same dimensions before replacing the original.
        guard let check = CGImageSourceCreateWithURL(tmp as CFURL, nil),
              let after = CGImageSourceCopyPropertiesAtIndex(check, 0, nil) as? [CFString: Any],
              after[kCGImagePropertyPixelWidth] as? Int == before[kCGImagePropertyPixelWidth] as? Int,
              after[kCGImagePropertyPixelHeight] as? Int == before[kCGImagePropertyPixelHeight] as? Int else {
            try? FileManager.default.removeItem(at: tmp)
            throw WriteError.verifyFailed
        }
        _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
    }

    /// Captions embedded in an image file (XMP, with legacy IPTC synthesized by ImageIO).
    static func readIPTC(from url: URL) -> IPTCInfo {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
              let meta = CGImageSourceCopyMetadataAtIndex(src, 0, nil),
              let data = CGImageMetadataCreateXMPData(meta, nil),
              let text = String(data: data as Data, encoding: .utf8) else { return IPTCInfo() }
        return XMPSidecar.readIPTC(text)
    }
}
