import Foundation

/// Per-photo variables, filled in from each photo's capture metadata when a caption is applied.
enum CaptionVariables {
    static let all = ["{date}", "{weekday}", "{shortdate}", "{time}", "{camera}", "{lens}",
                      "{focal}", "{shutter}", "{aperture}", "{iso}", "{filename}"]

    private static let longDate: DateFormatter = { let f = DateFormatter(); f.dateFormat = "MMMM d, yyyy"; return f }()
    private static let weekday: DateFormatter = { let f = DateFormatter(); f.dateFormat = "EEEE"; return f }()
    private static let shortDate: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f }()
    private static let time: DateFormatter = { let f = DateFormatter(); f.dateFormat = "h:mm a"; return f }()

    static func expand(_ s: String, for photo: Photo) -> String {
        guard s.contains("{") else { return s }
        let m = photo.metadata
        let date = m.captureDate
        var values: [String: String] = [
            "{date}": date.map(longDate.string) ?? "",
            "{weekday}": date.map(weekday.string) ?? "",
            "{shortdate}": date.map(shortDate.string) ?? "",
            "{time}": date.map(time.string) ?? "",
            "{camera}": m.camera,
            "{lens}": m.lens,
            "{filename}": photo.displayName,
            "{iso}": m.iso.map(String.init) ?? "",
        ]
        values["{focal}"] = m.focalLength.map { String(format: "%gmm", $0) } ?? ""
        values["{aperture}"] = m.fNumber.map { String(format: "f/%g", $0) } ?? ""
        values["{shutter}"] = m.exposureTime.map { $0 >= 0.5 ? String(format: "%g\"", $0) : "1/\(Int((1 / $0).rounded()))" } ?? ""
        var out = s
        for (k, v) in values { out = out.replacingOccurrences(of: k, with: v, options: .caseInsensitive) }
        return out
    }

    /// Codes first (they may produce variables), then this photo's variables.
    static func expandAll(_ s: String, for photo: Photo) -> String {
        expand(CodeReplacements.shared.expand(s), for: photo)
    }
}
