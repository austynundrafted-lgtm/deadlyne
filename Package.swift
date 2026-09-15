// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Deadlyne",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "Deadlyne",
            path: "Sources/Deadlyne",
            swiftSettings: [.unsafeFlags(["-Ounchecked"], .when(configuration: .release))]
        )
    ],
    swiftLanguageModes: [.v5]
)
