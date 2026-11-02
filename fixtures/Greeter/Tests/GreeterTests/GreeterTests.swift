import Testing
@testable import Greeter

@Suite struct GreeterTests {
    @Test func greet() {
        #expect(Greeter().greet("World") == "Hello, World!")
    }
}
