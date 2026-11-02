import Testing

@testable import SampleApp

@Suite struct CalculatorSwiftTests {
    @Test func divide() {
        #expect(Calculator().divide(6, 3) == 2)
    }

    @Test func divideByZeroFails() {
        // intentionally failing
        #expect(Calculator().divide(1, 0) == 0)
    }

    @Test(arguments: [1, 2, 3])
    func addZero(value: Int) {
        #expect(Calculator().add(value, 0) == value)
    }
}
