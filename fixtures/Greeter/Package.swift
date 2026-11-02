// swift-tools-version: 6.0
import PackageDescription

// A second package for e2e, to merge result bundles of two schemes (test plans).
let package = Package(
    name: "Greeter",
    platforms: [.macOS(.v14)],
    products: [.library(name: "Greeter", targets: ["Greeter"])],
    targets: [
        .target(name: "Greeter"),
        .testTarget(name: "GreeterTests", dependencies: ["Greeter"]),
    ]
)
