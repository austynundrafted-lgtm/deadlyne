import AppKit

/// One lookup file: a tab-delimited roster where each line is a code followed by one or more
/// expansion columns — `L7<TAB>Luka Dončić<TAB>Dallas Mavericks<TAB>Guard`.
final class CodeList {
    var url: URL
    /// Lines starting with `#`, kept at the top of the file.
    var comments: [String]
    /// `row[0]` is the code; `row[1...]` are expansion columns #1, #2, #3…
    var rows: [[String]]

    init(url: URL, comments: [String] = [], rows: [[String]] = []) {
        self.url = url
        self.comments = comments
        self.rows = rows
    }

    var name: String { url.deletingPathExtension().lastPathComponent }
    var fileName: String { url.lastPathComponent }

    /// Rows that have a code.
    var codeCount: Int { rows.filter { !($0.first ?? "").trimmingCharacters(in: .whitespaces).isEmpty }.count }

    /// Expansion columns in the widest row.
    var expansionColumns: Int { rows.map { $0.count - 1 }.max() ?? 0 }

    // MARK: Text format

    var text: String {
        var lines = comments
        for row in rows {
            var cells = row.map { $0.replacingOccurrences(of: "\t", with: " ").replacingOccurrences(of: "\n", with: " ") }
            while cells.count > 1, cells.last?.trimmingCharacters(in: .whitespaces).isEmpty == true { cells.removeLast() }
            guard cells.contains(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else { continue }
            lines.append(cells.joined(separator: "\t"))
        }
        return lines.joined(separator: "\n") + "\n"
    }

    /// Photo Mechanic–compatible: `code<TAB>col1<TAB>col2…`. A line without tabs may use
    /// `code=expansion`. Lines starting with `#` are comments.
    static func parse(_ text: String) -> (comments: [String], rows: [[String]]) {
        var comments: [String] = [], rows: [[String]] = []
        for raw in text.split(omittingEmptySubsequences: true, whereSeparator: \.isNewline) {
            let line = String(raw)
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { continue }
            if trimmed.hasPrefix("#") { comments.append(trimmed); continue }
            var cells: [String]
            if line.contains("\t") {
                cells = line.components(separatedBy: "\t")
            } else if let eq = line.firstIndex(of: "=") {
                cells = [String(line[..<eq]), String(line[line.index(after: eq)...])]
            } else {
                cells = [line]
            }
            cells = cells.map { $0.trimmingCharacters(in: .whitespaces) }
            // Photo Mechanic lists sometimes wrap codes in their delimiter.
            cells[0] = cells[0].trimmingCharacters(in: CharacterSet(charactersIn: CodeReplacements.delimiterChoices.joined()))
            while cells.count > 1, cells.last?.isEmpty == true { cells.removeLast() }
            rows.append(cells)
        }
        return (comments, rows)
    }

    /// Reads a roster in whatever encoding a spreadsheet or website saved it in. CSV files are
    /// converted to columns.
    static func readRows(from url: URL) throws -> (comments: [String], rows: [[String]]) {
        let data = try Data(contentsOf: url)
        let text = decode(data)
        if url.pathExtension.lowercased() == "csv" {
            return ([], parseCSV(text).map { row in
                var cells = row.map { $0.trimmingCharacters(in: .whitespaces) }
                while cells.count > 1, cells.last?.isEmpty == true { cells.removeLast() }
                return cells
            }.filter { $0.contains { !$0.isEmpty } })
        }
        return parse(text)
    }

    static func decode(_ data: Data) -> String {
        if data.starts(with: [0xFF, 0xFE]) || data.starts(with: [0xFE, 0xFF]) {
            return String(data: data, encoding: .utf16) ?? ""
        }
        var d = data
        if d.starts(with: [0xEF, 0xBB, 0xBF]) { d = d.dropFirst(3) }
        return String(data: d, encoding: .utf8)
            ?? String(data: d, encoding: .windowsCP1252)
            ?? String(data: d, encoding: .macOSRoman) ?? ""
    }

    static func parseCSV(_ text: String) -> [[String]] {
        var rows: [[String]] = [], row: [String] = [], cell = ""
        var quoted = false
        var chars = Array(text).makeIterator()
        var pending: Character?
        while let c = pending ?? chars.next() {
            pending = nil
            if quoted {
                if c == "\"" {
                    if let n = chars.next() {
                        if n == "\"" { cell.append("\"") } else { quoted = false; pending = n }
                    } else { quoted = false }
                } else { cell.append(c) }
            } else {
                switch c {
                case "\"": quoted = true
                case ",": row.append(cell); cell = ""
                case "\n", "\r", "\r\n":
                    row.append(cell); rows.append(row); row = []; cell = ""
                default: cell.append(c)
                }
            }
        }
        if !cell.isEmpty || !row.isEmpty { row.append(cell); rows.append(row) }
        return rows
    }
}

/// Photo Mechanic–style code replacements. While captioning, type a code wrapped in the
/// delimiter — `=L7=` — and it becomes the code's first expansion column. `=L7#2=` pulls
/// column #2 from the same line (a team, a position…).
///
/// Lookup files live in `~/Library/Application Support/Deadlyne/Code Replacements/`, one roster
/// per file. Any number can be active at once (home roster, away roster, venues); when two
/// active files share a code, the one whose name sorts first wins.
final class CodeReplacements {
    static let shared = CodeReplacements()
    static let didChange = Notification.Name("DeadlyneCodeReplacementsDidChange")

    static var supportDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Deadlyne", isDirectory: true)
    }
    static var listsDirectory: URL { supportDirectory.appendingPathComponent("Code Replacements", isDirectory: true) }
    /// The single file Deadlyne used before lookup files could be managed separately.
    static var legacyFileURL: URL { supportDirectory.appendingPathComponent("CodeReplacements.txt") }

    /// Characters offered as the delimiter. `#` is reserved for the column modifier.
    static let delimiterChoices = ["=", "\\", ";", "~", "`", "|", "^"]

    private static let delimiterKey = "codeDelimiter"
    private static let liveKey = "codeExpandWhileTyping"
    private static let disabledKey = "codeListsDisabled"
    private static let columnNamesKey = "codeColumnNames"
    private static let seededKey = "codeListsSeeded"
    /// Longest code recognized between two delimiters.
    static let maxCodeLength = 48

    private(set) var lists: [CodeList] = []
    /// Lower-cased code → its expansion columns and the file it came from (active files only).
    private var table: [String: (values: [String], list: CodeList)] = [:]
    /// Codes defined by more than one active file, with the files' names.
    private(set) var conflicts: [String: [String]] = [:]
    private var loadedDates: [String: Date] = [:]

    /// False while `shared` is being created: an observer reading `shared` from inside
    /// its own initializer would deadlock.
    private var ready = false

    private init() {
        UserDefaults.standard.register(defaults: [Self.delimiterKey: "=", Self.liveKey: true])
        reload()
        ready = true
    }

    // MARK: Settings

    var delimiter: String {
        get {
            let d = UserDefaults.standard.string(forKey: Self.delimiterKey) ?? "="
            return Self.delimiterChoices.contains(d) ? d : "="
        }
        set {
            UserDefaults.standard.set(newValue, forKey: Self.delimiterKey)
            notify()
        }
    }

    var expandsWhileTyping: Bool {
        get { UserDefaults.standard.bool(forKey: Self.liveKey) }
        set {
            UserDefaults.standard.set(newValue, forKey: Self.liveKey)
            notify()
        }
    }

    func isEnabled(_ list: CodeList) -> Bool {
        !(UserDefaults.standard.stringArray(forKey: Self.disabledKey) ?? []).contains(list.fileName)
    }

    func setEnabled(_ on: Bool, for list: CodeList) {
        var off = Set(UserDefaults.standard.stringArray(forKey: Self.disabledKey) ?? [])
        if on { off.remove(list.fileName) } else { off.insert(list.fileName) }
        UserDefaults.standard.set(off.sorted(), forKey: Self.disabledKey)
        rebuild()
    }

    var activeLists: [CodeList] { lists.filter(isEnabled) }
    var activeCodeCount: Int { table.count }

    /// Optional names for a file's expansion columns ("Name", "Team", "Position").
    func columnNames(for list: CodeList) -> [String] {
        let all = UserDefaults.standard.dictionary(forKey: Self.columnNamesKey) as? [String: [String]]
        return all?[list.fileName] ?? []
    }

    func setColumnName(_ name: String, column: Int, for list: CodeList) {
        var all = UserDefaults.standard.dictionary(forKey: Self.columnNamesKey) as? [String: [String]] ?? [:]
        var names = all[list.fileName] ?? []
        while names.count < column { names.append("") }
        names[column - 1] = name.trimmingCharacters(in: .whitespaces)
        while names.last?.isEmpty == true { names.removeLast() }
        all[list.fileName] = names.isEmpty ? nil : names
        UserDefaults.standard.set(all, forKey: Self.columnNamesKey)
        notify()
    }

    private func moveColumnNames(from old: String, to new: String) {
        var all = UserDefaults.standard.dictionary(forKey: Self.columnNamesKey) as? [String: [String]] ?? [:]
        all[new] = all.removeValue(forKey: old)
        UserDefaults.standard.set(all, forKey: Self.columnNamesKey)
    }

    // MARK: Files

    func reload() {
        let fm = FileManager.default
        let dir = Self.listsDirectory
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        seedIfNeeded()
        let urls = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey],
                                                options: [.skipsHiddenFiles])) ?? []
        loadedDates = [:]
        lists = urls
            .filter { ["txt", "tsv", "tab", "csv"].contains($0.pathExtension.lowercased()) }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
            .map { url in
                loadedDates[url.lastPathComponent] = Self.modificationDate(url)
                let parsed = (try? CodeList.readRows(from: url)) ?? (comments: [], rows: [])
                return CodeList(url: url, comments: parsed.comments, rows: parsed.rows)
            }
        rebuild()
    }

    /// Picks up lookup files edited or added outside Deadlyne (a text editor, the Finder).
    func reloadIfChangedOnDisk() {
        let fm = FileManager.default
        let names = (try? fm.contentsOfDirectory(atPath: Self.listsDirectory.path))?.filter { !$0.hasPrefix(".") } ?? []
        let current = Dictionary(uniqueKeysWithValues: names.map {
            ($0, Self.modificationDate(Self.listsDirectory.appendingPathComponent($0)) ?? .distantPast)
        })
        let loaded = loadedDates
        let relevant = current.filter { ["txt", "tsv", "tab", "csv"].contains(($0.key as NSString).pathExtension.lowercased()) }
        if relevant != loaded { reload() }
    }

    private static func modificationDate(_ url: URL) -> Date? {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    }

    /// First launch: carries over the old single file, or writes a sample roster to learn from.
    private func seedIfNeeded() {
        let d = UserDefaults.standard
        guard !d.bool(forKey: Self.seededKey) else { return }
        d.set(true, forKey: Self.seededKey)
        let fm = FileManager.default
        let legacy = Self.legacyFileURL
        if fm.fileExists(atPath: legacy.path) {
            try? fm.moveItem(at: legacy, to: Self.listsDirectory.appendingPathComponent("My Codes.txt"))
            return
        }
        let sample = """
        # A sample lookup file. Replace it with your rosters, or import one (a .txt or .csv).
        # Each line: code, Tab, then as many columns as you like. Column #1 is what =code= types.
        f10\tJordan Sample (10)\tFairborn Skyhawks\tquarterback
        f22\tAvery Example (22)\tFairborn Skyhawks\trunning back
        t7\tCasey Placeholder (7)\tTecumseh Arrows\twide receiver
        t73\tRiley Demo (73)\tTecumseh Arrows\toffensive lineman
        fhs\tFairborn High School
        ths\tTecumseh High School

        """
        let url = Self.listsDirectory.appendingPathComponent("Sample Roster.txt")
        try? sample.write(to: url, atomically: true, encoding: .utf8)
        var names = d.dictionary(forKey: Self.columnNamesKey) as? [String: [String]] ?? [:]
        names[url.lastPathComponent] = ["Name", "Team", "Position"]
        d.set(names, forKey: Self.columnNamesKey)
    }

    func save(_ list: CodeList) {
        do {
            try list.text.write(to: list.url, atomically: true, encoding: .utf8)
            loadedDates[list.fileName] = Self.modificationDate(list.url)
        } catch {
            NSLog("Deadlyne: couldn't save %@: %@", list.url.path, error.localizedDescription)
        }
        rebuild()
    }

    @discardableResult
    func createList(named name: String, rows: [[String]] = [], comments: [String] = []) -> CodeList {
        let url = uniqueURL(for: name)
        let list = CodeList(url: url, comments: comments, rows: rows)
        try? list.text.write(to: url, atomically: true, encoding: .utf8)
        reload()
        return lists.first { $0.fileName == url.lastPathComponent } ?? list
    }

    /// Copies a roster into Deadlyne's lookup files (as tab-delimited UTF-8) and turns it on.
    func importFile(_ source: URL) throws -> CodeList {
        let parsed = try CodeList.readRows(from: source)
        guard !parsed.rows.isEmpty else {
            throw NSError(domain: "Deadlyne", code: 1, userInfo: [NSLocalizedDescriptionKey:
                "“\(source.lastPathComponent)” doesn’t contain any codes.",
                NSLocalizedRecoverySuggestionErrorKey: "Each line needs a code, a Tab, then the text it expands to."])
        }
        // A spreadsheet export often starts with a header row ("Code, Name, Team…"): use it to
        // name the columns instead of importing it as a code.
        var rows = parsed.rows
        var header: [String]?
        let headerWords: Set<String> = ["code", "codes", "shortcut", "key", "#", "no", "no.", "num", "number", "jersey"]
        if let first = rows.first, headerWords.contains(first[0].lowercased()), rows.count > 1 {
            header = Array(first.dropFirst())
            rows.removeFirst()
        }
        let list = createList(named: source.deletingPathExtension().lastPathComponent, rows: rows, comments: parsed.comments)
        if let header {
            for (i, name) in header.enumerated() where !name.isEmpty { setColumnName(name, column: i + 1, for: list) }
        }
        return list
    }

    func rename(_ list: CodeList, to newName: String) throws {
        let clean = Self.sanitize(newName)
        guard !clean.isEmpty, clean != list.name else { return }
        let old = list.fileName
        let wasEnabled = isEnabled(list)
        let target = uniqueURL(for: clean)
        try FileManager.default.moveItem(at: list.url, to: target)
        moveColumnNames(from: old, to: target.lastPathComponent)
        list.url = target
        var off = Set(UserDefaults.standard.stringArray(forKey: Self.disabledKey) ?? [])
        off.remove(old)
        if !wasEnabled { off.insert(target.lastPathComponent) }
        UserDefaults.standard.set(off.sorted(), forKey: Self.disabledKey)
        reload()
    }

    /// Moves a lookup file to the Trash (recoverable).
    func trash(_ list: CodeList) throws {
        try FileManager.default.trashItem(at: list.url, resultingItemURL: nil)
        reload()
    }

    private func uniqueURL(for name: String) -> URL {
        let base = Self.sanitize(name).isEmpty ? "Untitled" : Self.sanitize(name)
        var url = Self.listsDirectory.appendingPathComponent(base + ".txt")
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = Self.listsDirectory.appendingPathComponent("\(base) \(n).txt")
            n += 1
        }
        return url
    }

    private static func sanitize(_ name: String) -> String {
        name.components(separatedBy: CharacterSet(charactersIn: "/:")).joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
    }

    private func rebuild() {
        table = [:]
        var owners: [String: [String]] = [:]
        for list in lists where isEnabled(list) {
            var seen = Set<String>()
            for row in list.rows {
                let code = (row.first ?? "").trimmingCharacters(in: .whitespaces).lowercased()
                guard !code.isEmpty, seen.insert(code).inserted else { continue }
                owners[code, default: []].append(list.name)
                if table[code] == nil { table[code] = (Array(row.dropFirst()), list) }
            }
        }
        conflicts = owners.filter { $0.value.count > 1 }
        notify()
    }

    private func notify() {
        guard ready else { return }
        NotificationCenter.default.post(name: Self.didChange, object: self)
    }

    // MARK: Lookup

    struct Lookup {
        let token: String
        let code: String
        let column: Int
        let text: String
        let list: CodeList
    }

    /// `L7` → column #1 of L7; `L7#2` → column #2. Codes aren't case-sensitive.
    func resolve(_ token: String) -> Lookup? {
        guard !token.isEmpty else { return nil }
        if let hash = token.lastIndex(of: "#"), hash != token.startIndex,
           let column = Int(token[token.index(after: hash)...]), column >= 1,
           let hit = table[token[..<hash].lowercased()], !hit.values.isEmpty {
            let text = column <= hit.values.count ? hit.values[column - 1] : ""
            return Lookup(token: token, code: String(token[..<hash]), column: column, text: text, list: hit.list)
        }
        // A code with nothing after it has nothing to expand to, so it stays as typed.
        guard let hit = table[token.lowercased()], !hit.values.isEmpty else { return nil }
        return Lookup(token: token, code: token, column: 1, text: hit.values.first ?? "", list: hit.list)
    }

    private var delimiterUnit: unichar { (delimiter as NSString).character(at: 0) }

    private static func isBreak(_ c: unichar) -> Bool {
        guard let scalar = Unicode.Scalar(c) else { return false }
        return CharacterSet.whitespacesAndNewlines.contains(scalar)
    }

    /// Expands every known `=code=` / `=code#n=` in `s`. Unknown codes are left as typed.
    func expand(_ s: String) -> String {
        guard !table.isEmpty, s.contains(delimiter) else { return s }
        let ns = s as NSString
        let d = delimiterUnit
        var out = ""
        var last = 0, i = 0
        while i < ns.length {
            guard ns.character(at: i) == d else { i += 1; continue }
            var j = i + 1
            while j < ns.length, j - i <= Self.maxCodeLength + 1, ns.character(at: j) != d, !Self.isBreak(ns.character(at: j)) {
                j += 1
            }
            guard j < ns.length, ns.character(at: j) == d else { i += 1; continue }
            if j > i + 1, let hit = resolve(ns.substring(with: NSRange(location: i + 1, length: j - i - 1))) {
                out += ns.substring(with: NSRange(location: last, length: i - last)) + hit.text
                i = j + 1
                last = i
            } else {
                i = j // the closing delimiter may open the next code
            }
        }
        return out + ns.substring(from: last)
    }

    /// A `=token=` whose closing delimiter sits just before `end`, if there is one.
    func candidate(endingAt end: Int, in ns: NSString) -> (range: NSRange, token: String)? {
        let d = delimiterUnit
        guard end >= 3, end <= ns.length, ns.character(at: end - 1) == d else { return nil }
        var k = end - 2
        while k >= 0, end - 2 - k < Self.maxCodeLength, ns.character(at: k) != d, !Self.isBreak(ns.character(at: k)) {
            k -= 1
        }
        guard k >= 0, k < end - 2, ns.character(at: k) == d else { return nil }
        return (NSRange(location: k, length: end - k), ns.substring(with: NSRange(location: k + 1, length: end - k - 2)))
    }
}

/// Expands a code the moment its closing delimiter is typed, in any text view or field editor.
/// Pasted text is expanded too, so a caption pasted from notes full of codes comes out finished.
enum LiveCodeExpansion {
    private static var expanding = false

    enum Result {
        /// The code whose closing delimiter was just typed.
        case expanded(CodeReplacements.Lookup)
        /// Several codes at once (a paste).
        case expandedPaste
        case unknown(String)
    }

    /// Call from `textDidChange` / `controlTextDidChange`. Replaces codes as one undoable edit.
    @discardableResult
    static func apply(to textView: NSTextView, force: Bool = false) -> Result? {
        let codes = CodeReplacements.shared
        guard !expanding, force || codes.expandsWhileTyping, !textView.hasMarkedText() else { return nil }
        let sel = textView.selectedRange()
        guard sel.length == 0, sel.location > 0 else { return nil }
        let ns = textView.string as NSString
        let typed = codes.candidate(endingAt: sel.location, in: ns)
        let before = ns.substring(to: sel.location)
        let after = codes.expand(before) as NSString
        guard after as String != before else { return typed.map { .unknown($0.token) } }

        // Replace only the part that changed, keeping the undo step and attributes tight.
        let old = before as NSString
        var head = 0
        while head < old.length, head < after.length, old.character(at: head) == after.character(at: head) { head += 1 }
        var tail = 0
        while tail < old.length - head, tail < after.length - head,
              old.character(at: old.length - 1 - tail) == after.character(at: after.length - 1 - tail) { tail += 1 }
        let range = NSRange(location: head, length: old.length - head - tail)
        let replacement = after.substring(with: NSRange(location: head, length: after.length - head - tail))

        expanding = true
        defer { expanding = false }
        textView.breakUndoCoalescing()
        if textView.shouldChangeText(in: range, replacementString: replacement) {
            textView.textStorage?.replaceCharacters(in: range, with: replacement)
            textView.didChangeText()
            textView.setSelectedRange(NSRange(location: after.length, length: 0))
        }
        textView.breakUndoCoalescing()
        if let typed, let hit = codes.resolve(typed.token) { return .expanded(hit) }
        return .expandedPaste
    }
}
