import Foundation

extension Int {
    /// Decimal grouping for photo counts and file-operation progress.
    var grouped: String { formatted(.number) }
}
