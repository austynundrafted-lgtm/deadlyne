import Foundation

/// A readable name for a shoot folder, for Home. Folder names are written for the file system:
/// "Boys_Varsity-Fairborn-vs-Tecumseh_082126" shows as "Fairborn vs. Tecumseh", with "Boys Varsity"
/// and Aug 21, 2026 underneath. The real folder name stays in tooltips and menus.
struct ShootName {
    var title: String
    /// Team level or sport pulled out of the name ("Boys Varsity"), if any.
    var context: String?
    /// A date written into the name, if any.
    var date: Date?

    init(_ folderName: String) {
        var text = folderName
        var date: Date?
        // Dashed dates first ("2026-09-11"), since "-" also separates words.
        if let r = text.range(of: #"(19|20)\d\d[-.](1[0-2]|0?[1-9])[-.](3[01]|[12]\d|0?[1-9])(?!\d)"#, options: .regularExpression) {
            let parts = text[r].split(whereSeparator: { $0 == "-" || $0 == "." }).compactMap { Int($0) }
            date = Self.makeDate(parts[0], parts[1], parts[2])
            text.replaceSubrange(r, with: "_")
        }
        // Words, remembering which "_"-separated chunk each came from.
        var words: [(text: String, chunk: Int)] = []
        for (c, chunk) in text.split(separator: "_").enumerated() {
            for w in chunk.split(whereSeparator: { $0 == "-" || $0 == " " }) { words.append((String(w), c)) }
        }
        if date == nil, let i = words.firstIndex(where: { Self.parseDigits($0.text) != nil }) {
            date = Self.parseDigits(words[i].text)
            words.remove(at: i)
        }

        var context: [String] = []
        while let w = words.first, Self.contextWords.contains(w.text.lowercased()) {
            context.append(w.text)
            words.removeFirst()
        }
        var trailing: [String] = []
        while let w = words.last, Self.contextWords.contains(w.text.lowercased()) {
            trailing.insert(w.text, at: 0)
            words.removeLast()
        }
        context += trailing

        let spaced = { (ws: ArraySlice<(text: String, chunk: Int)>) in ws.map { Self.splitCamelCase($0.text) }.joined(separator: " ") }
        var title: String
        if let v = words.firstIndex(where: { Self.versus.contains($0.text.lowercased()) }), v > 0, v < words.count - 1 {
            title = spaced(words[..<v]) + " vs. " + spaced(words[(v + 1)...])
        } else {
            // No matchup: keep the folder's own grouping.
            let chunks = Dictionary(grouping: words, by: \.chunk).sorted { $0.key < $1.key }
            title = chunks.map { spaced($0.value[...]) }.joined(separator: " · ")
        }
        if title.isEmpty {
            title = context.isEmpty ? folderName : context.joined(separator: " ")
            context = []
        }
        self.title = title
        self.context = context.isEmpty ? nil : context.joined(separator: " ")
        self.date = date
    }

    private static let versus: Set<String> = ["vs", "vs.", "v", "v.", "versus"]

    private static let contextWords: Set<String> = [
        "boys", "girls", "men", "mens", "men's", "women", "womens", "women's", "coed",
        "varsity", "jv", "reserve", "freshman", "frosh", "junior", "senior", "hs", "ms", "ncaa",
        "football", "soccer", "basketball", "volleyball", "baseball", "softball", "lacrosse", "hockey",
        "wrestling", "tennis", "golf", "track", "xc", "swim", "swimming", "diving", "cheer", "bowling",
        "rugby", "gymnastics",
    ]

    /// "TippCity" → "Tipp City". Leaves "McFadden", "JV" and "iPhone" alone.
    static func splitCamelCase(_ s: String) -> String {
        let chars = Array(s)
        guard chars.count > 1 else { return s }
        let cuts = (1..<chars.count).filter { chars[$0].isUppercase && chars[$0 - 1].isLowercase }
        var out = "", start = 0
        for (n, cut) in cuts.enumerated() {
            let end = n + 1 < cuts.count ? cuts[n + 1] : chars.count
            if cut - start >= 3, end - cut >= 3 {
                out += String(chars[start..<cut]) + " "
                start = cut
            }
        }
        return out + String(chars[start...])
    }

    /// "082126" (MMDDYY), "260821" (YYMMDD), "20260821" or "08212026".
    private static func parseDigits(_ s: String) -> Date? {
        guard s.allSatisfy(\.isASCII), s.allSatisfy(\.isNumber) else { return nil }
        let n = s.compactMap(\.wholeNumberValue)
        func num(_ r: Range<Int>) -> Int { r.reduce(0) { $0 * 10 + n[$1] } }
        switch n.count {
        case 6: return makeDate(2000 + num(4..<6), num(0..<2), num(2..<4)) ?? makeDate(2000 + num(0..<2), num(2..<4), num(4..<6))
        case 8:
            let ymd = makeDate(num(0..<4), num(4..<6), num(6..<8))
            return (19...20).contains(num(0..<2)) ? ymd : makeDate(num(4..<8), num(0..<2), num(2..<4))
        default: return nil
        }
    }

    private static func makeDate(_ y: Int, _ m: Int, _ d: Int) -> Date? {
        guard (1...12).contains(m), (1...31).contains(d) else { return nil }
        let cal = Calendar.current
        guard let date = cal.date(from: DateComponents(year: y, month: m, day: d)),
              cal.component(.day, from: date) == d else { return nil } // rejects Feb 30
        return date
    }
}
