import Foundation

/// Reads and writes culling data and captions in Adobe-compatible XMP sidecars (`BASENAME.xmp`).
///
/// Lightroom, Camera Raw, Bridge, Capture One and Photo Mechanic all read `xmp:Rating`,
/// `xmp:Label` and the IPTC properties from the same sidecar. Existing sidecars (with Camera Raw
/// develop settings etc.) are edited in place — we only ever touch our own properties, never the
/// rest of the file.
enum XMPSidecar {
    static let deadlyneNS = "http://ns.deadlyne.app/1.0/"

    struct Values {
        var rating = 0
        var label: ColorLabel?
        var tagged = false
    }

    static func read(_ url: URL) -> Values? {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return readCulling(text)
    }

    /// Culling values and captions from one read of the file.
    static func readAll(_ url: URL) -> (Values, IPTCInfo)? {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return (readCulling(text), readIPTC(text))
    }

    static func readCulling(_ text: String) -> Values {
        var v = Values()
        if let r = value(of: "xmp:Rating", in: text), let n = Int(r) { v.rating = max(0, min(5, n)) }
        if let l = value(of: "xmp:Label", in: text) { v.label = ColorLabel(rawValue: l) }
        // "lensdesk:Tagged" was written before the app was renamed to Deadlyne.
        if let t = value(of: "deadlyne:Tagged", in: text) ?? value(of: "lensdesk:Tagged", in: text)
            ?? value(of: "photomechanic:Tagged", in: text) {
            v.tagged = t.lowercased() == "true"
        }
        return v
    }

    static func readIPTC(_ text: String) -> IPTCInfo {
        var info = IPTCInfo()
        for f in IPTCField.allCases {
            switch f.kind {
            case .simple:
                if let v = value(of: f.xmpPath, in: text) { info[f] = unescape(v) }
            case .langAlt, .bag, .seq:
                let items = listItems(f.xmpPath, in: text)
                if f == .keywords {
                    info.keywords = items
                } else if !items.isEmpty {
                    info[f] = f.kind == .seq ? items.joined(separator: "; ") : items[0]
                } else if let v = value(of: f.xmpPath, in: text) {
                    info[f] = unescape(v)
                }
            }
        }
        return info
    }

    static func write(_ v: Values, to url: URL, sidecarForExtension ext: String) throws {
        try update(url, sidecarForExtension: ext, culling: v)
    }

    /// Updates culling values and/or the given caption fields, leaving everything else untouched.
    static func update(_ url: URL, sidecarForExtension ext: String, culling v: Values?,
                       iptc: IPTCInfo? = nil, fields: Set<IPTCField> = []) throws {
        let fm = FileManager.default
        var text: String
        if fm.fileExists(atPath: url.path) {
            text = try String(contentsOf: url, encoding: .utf8)
        } else {
            let cullingEmpty = v.map { $0.rating == 0 && $0.label == nil && !$0.tagged } ?? true
            let iptcEmpty = iptc.map { info in fields.allSatisfy { info[$0].isEmpty } } ?? true
            if cullingEmpty && iptcEmpty { return } // nothing worth writing
            text = template(sidecarForExtension: ext)
        }
        if let v {
            text = set("xmp:Rating", v.rating == 0 && !text.contains("xmp:Rating") ? nil : String(v.rating), in: text)
            text = set("xmp:Label", v.label?.rawValue, in: text)
            text = set("deadlyne:Tagged", v.tagged ? "True" : nil, in: text)
            if text.contains("deadlyne:Tagged"), !text.contains("xmlns:deadlyne") {
                text = insertAttribute("xmlns:deadlyne=\"\(deadlyneNS)\"", in: text)
            }
            // Migrate the pre-rename tag so it can't resurface after the photo is untagged.
            text = set("lensdesk:Tagged", nil, in: text)
            text = set("xmlns:lensdesk", nil, in: text)
        }
        if let iptc {
            text = applyIPTC(iptc, fields: fields, to: text)
        }
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    // MARK: - IPTC writing

    static func applyIPTC(_ info: IPTCInfo, fields: Set<IPTCField>, to original: String) -> String {
        var text = original
        for f in IPTCField.allCases where fields.contains(f) {
            text = removeElement(f.xmpPath, in: text)
            text = set(f.xmpPath, nil, in: text)
            let value = info[f]
            guard !value.isEmpty else { continue }
            if !text.contains("xmlns:\(f.prefix)=") {
                text = insertAttribute("xmlns:\(f.prefix)=\"\(f.namespace)\"", in: text)
            }
            switch f.kind {
            case .simple:
                text = set(f.xmpPath, value.replacingOccurrences(of: "\n", with: " "), in: text)
            case .langAlt:
                text = insertElement(structure(f.xmpPath, container: "rdf:Alt", items: [value], lang: true), in: text)
            case .bag:
                text = insertElement(structure(f.xmpPath, container: "rdf:Bag", items: info.keywords, lang: false), in: text)
            case .seq:
                let items = value.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                text = insertElement(structure(f.xmpPath, container: "rdf:Seq", items: items, lang: false), in: text)
            }
        }
        return text
    }

    private static func structure(_ name: String, container: String, items: [String], lang: Bool) -> String {
        let lis = items.map { "     <rdf:li\(lang ? " xml:lang=\"x-default\"" : "")>\(escape($0))</rdf:li>" }
        return (["   <\(name)>", "    <\(container)>"] + lis + ["    </\(container)>", "   </\(name)>"]).joined(separator: "\n")
    }

    /// Inserts a child element just before the first `</rdf:Description>`, converting a
    /// self-closing description into an open/close pair if needed.
    private static func insertElement(_ element: String, in original: String) -> String {
        var text = original
        if text.range(of: "</rdf:Description>") == nil, let end = descriptionStartTagEnd(in: text),
           text[text.index(before: end)] == "/" {
            text.replaceSubrange(text.index(before: end)...end, with: ">\n  </rdf:Description>")
        }
        guard let close = text.range(of: "</rdf:Description>") else { return text }
        // Keep the closing tag's own indentation intact.
        var lineStart = close.lowerBound
        while lineStart > text.startIndex, text[text.index(before: lineStart)] == " " { lineStart = text.index(before: lineStart) }
        text.insert(contentsOf: element + "\n", at: lineStart)
        return text
    }

    private static func removeElement(_ name: String, in text: String) -> String {
        let n = NSRegularExpression.escapedPattern(for: name)
        let re = try! NSRegularExpression(pattern: "\\n?[ \\t]*<\(n)(\\s*/>|>[\\s\\S]*?</\(n)>)")
        return re.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
    }

    private static func listItems(_ name: String, in text: String) -> [String] {
        let n = NSRegularExpression.escapedPattern(for: name)
        guard let block = try? NSRegularExpression(pattern: "<\(n)>([\\s\\S]*?)</\(n)>"),
              let m = block.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let r = Range(m.range(at: 1), in: text) else { return [] }
        let inner = String(text[r])
        let li = try! NSRegularExpression(pattern: "<rdf:li[^>]*>([\\s\\S]*?)</rdf:li>")
        return li.matches(in: inner, range: NSRange(inner.startIndex..., in: inner)).compactMap {
            Range($0.range(at: 1), in: inner).map { unescape(String(inner[$0])) }
        }.filter { !$0.isEmpty }
    }

    static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    static func unescape(_ s: String) -> String {
        s.replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&#xA;", with: "\n").replacingOccurrences(of: "&#10;", with: "\n")
            .replacingOccurrences(of: "&amp;", with: "&")
    }

    // MARK: - Helpers

    private static func template(sidecarForExtension ext: String) -> String {
        """
        <x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Deadlyne">
         <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
          <rdf:Description rdf:about=""
            xmlns:xmp="http://ns.adobe.com/xap/1.0/"
            xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
           photoshop:SidecarForExtension="\(ext)">
          </rdf:Description>
         </rdf:RDF>
        </x:xmpmeta>

        """
    }

    /// Supports both attribute form (`xmp:Rating="3"`) and element form (`<xmp:Rating>3</xmp:Rating>`).
    private static func value(of name: String, in text: String) -> String? {
        let n = NSRegularExpression.escapedPattern(for: name)
        for pattern in ["\\s\(n)=\"([^\"]*)\"", "<\(n)>([^<]*)</\(n)>"] {
            if let re = try? NSRegularExpression(pattern: pattern),
               let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
               let r = Range(m.range(at: 1), in: text) {
                return String(text[r])
            }
        }
        return nil
    }

    /// Sets (or with nil, removes) a simple property, preserving everything else in the file.
    private static func set(_ name: String, _ value: String?, in text: String) -> String {
        let n = NSRegularExpression.escapedPattern(for: name)
        let range = NSRange(text.startIndex..., in: text)
        let attr = try! NSRegularExpression(pattern: "\\s*\(n)=\"[^\"]*\"")
        let elem = try! NSRegularExpression(pattern: "\\s*<\(n)>[^<]*</\(n)>")
        let escaped = escape(value ?? "")

        if attr.firstMatch(in: text, range: range) != nil {
            let replacement = value == nil ? "" : "\n   \(name)=\"\(NSRegularExpression.escapedTemplate(for: escaped))\""
            return attr.stringByReplacingMatches(in: text, range: range, withTemplate: replacement)
        }
        if elem.firstMatch(in: text, range: range) != nil {
            let replacement = value == nil ? "" : "\n   <\(name)>\(NSRegularExpression.escapedTemplate(for: escaped))</\(name)>"
            return elem.stringByReplacingMatches(in: text, range: range, withTemplate: replacement)
        }
        guard value != nil else { return text }
        var out = insertAttribute("\(name)=\"\(escaped)\"", in: text)
        if name.hasPrefix("xmp:"), !out.contains("xmlns:xmp=") {
            out = insertAttribute("xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"", in: out)
        }
        return out
    }

    /// End index (the `>`) of the first `<rdf:Description …>` start tag.
    private static func descriptionStartTagEnd(in text: String) -> String.Index? {
        guard let start = text.range(of: "<rdf:Description") else { return nil }
        var i = start.upperBound
        var quote: Character?
        while i < text.endIndex {
            let c = text[i]
            if let q = quote { if c == q { quote = nil } }
            else if c == "\"" || c == "'" { quote = c }
            else if c == ">" { return i }
            i = text.index(after: i)
        }
        return nil
    }

    /// Inserts an attribute into the first `<rdf:Description …>` start tag.
    private static func insertAttribute(_ attribute: String, in text: String) -> String {
        guard let start = text.range(of: "<rdf:Description"), let end = descriptionStartTagEnd(in: text) else { return text }
        let selfClosing = text.index(before: end) > start.upperBound && text[text.index(before: end)] == "/"
        var out = text
        out.insert(contentsOf: "\n   \(attribute)", at: selfClosing ? text.index(before: end) : end)
        return out
    }
}
