// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SampleApp",
    platforms: [.macOS(.v14)],
    products: [.library(name: "SampleApp", targets: ["SampleApp"])],
    targets: [
        .target(name: "SampleApp"),
        .testTarget(name: "SampleAppTests", dependencies: ["SampleApp"]),
    ]
)
