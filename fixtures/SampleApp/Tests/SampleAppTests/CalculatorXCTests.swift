import XCTest

@testable import SampleApp

final class CalculatorXCTests: XCTestCase {
    func testAdd() {
        XCTAssertEqual(Calculator().add(1, 2), 3)
    }

    func testSubtractFails() {
        // intentionally failing
        XCTAssertEqual(Calculator().subtract(5, 3), 3, "5 - 3 should be 2")
    }

    func testSkipped() throws {
        throw XCTSkip("skipped on purpose")
    }
}
