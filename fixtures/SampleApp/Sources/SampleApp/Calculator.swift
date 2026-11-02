public struct Calculator {
    public init() {}

    public func add(_ a: Int, _ b: Int) -> Int {
        a + b
    }

    public func subtract(_ a: Int, _ b: Int) -> Int {
        let unused = 0  // intentional warning for the build-results fixture
        return a - b
    }

    public func divide(_ a: Int, _ b: Int) -> Int? {
        if b == 0 {
            return nil
        }
        return a / b
    }

    // intentionally not tested, to make coverage less than 100%
    public func multiply(_ a: Int, _ b: Int) -> Int {
        a * b
    }
}
