import Foundation

/// The caption fields Deadlyne edits, mapped to the standard IPTC-in-XMP properties that
/// Lightroom, Photo Mechanic, Photoshop and newsroom systems read.
enum IPTCField: String, CaseIterable {
    case headline, caption, keywords, event, location, city, state, country, creator, credit, copyright

    enum Kind { case simple, langAlt, bag, seq }

    var label: String {
        switch self {
        case .headline: return "Headline"
        case .caption: return "Caption"
        case .keywords: return "Keywords"
        case .event: return "Event"
        case .location: return "Venue"
        case .city: return "City"
        case .state: return "State"
        case .country: return "Country"
        case .creator: return "Photographer"
        case .credit: return "Credit"
        case .copyright: return "Copyright"
        }
    }

    var prefix: String {
        switch self {
        case .caption, .keywords, .creator, .copyright: return "dc"
        case .headline, .city, .state, .country, .credit: return "photoshop"
        case .location: return "Iptc4xmpCore"
        case .event: return "Iptc4xmpExt"
        }
    }

    var namespace: String {
        switch prefix {
        case "dc": return "http://purl.org/dc/elements/1.1/"
        case "photoshop": return "http://ns.adobe.com/photoshop/1.0/"
        case "Iptc4xmpCore": return "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
        default: return "http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
        }
    }

    var name: String {
        switch self {
        case .headline: return "Headline"
        case .caption: return "description"
        case .keywords: return "subject"
        case .event: return "Event"
        case .location: return "Location"
        case .city: return "City"
        case .state: return "State"
        case .country: return "Country"
        case .creator: return "creator"
        case .credit: return "Credit"
        case .copyright: return "rights"
        }
    }

    var kind: Kind {
        switch self {
        case .caption, .event, .copyright: return .langAlt
        case .keywords: return .bag
        case .creator: return .seq
        default: return .simple
        }
    }

    var xmpPath: String { "\(prefix):\(name)" }
}

struct IPTCInfo: Equatable {
    var text: [IPTCField: String] = [:]
    var keywords: [String] = []

    subscript(field: IPTCField) -> String {
        get { field == .keywords ? keywords.joined(separator: ", ") : text[field] ?? "" }
        set {
            if field == .keywords {
                keywords = IPTCInfo.splitKeywords(newValue)
            } else {
                let v = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
                text[field] = v.isEmpty ? nil : v
            }
        }
    }

    var hasCaption: Bool { !(text[.caption] ?? "").isEmpty }
    var isEmpty: Bool { text.values.allSatisfy(\.isEmpty) && keywords.isEmpty }

    static func splitKeywords(_ s: String) -> [String] {
        var seen = Set<String>()
        return s.split(whereSeparator: { $0 == "," || $0 == ";" || $0 == "\n" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
    }

    /// Case-insensitive search across caption fields, used by the search box.
    func matches(_ query: String) -> Bool {
        text.values.contains { $0.localizedCaseInsensitiveContains(query) }
            || keywords.contains { $0.localizedCaseInsensitiveContains(query) }
    }
}
