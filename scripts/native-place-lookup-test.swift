import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: Bool, _ message: String) throws {
    if !condition { throw TestFailure(description: message) }
}

private func row(_ id: Int, name: String = "Hardin", state: String = "Kentucky", code: String = "US", country: String = "United States") -> [String: Any] {
    ["id": id, "name": name, "admin1": state, "country": country, "country_code": code,
     "latitude": 36.7634, "longitude": -88.3014, "timezone": "America/Chicago", "population": 600, "feature_code": "PPL"]
}

private func payload(_ rows: [[String: Any]]) throws -> Data {
    try JSONSerialization.data(withJSONObject: ["results": rows])
}

private actor FixtureTransport {
    var requests: [URLRequest] = []
    let data: Data
    let status: Int
    let delay: UInt64
    var cancelled = false

    init(data: Data, status: Int = 200, delay: UInt64 = 0) { self.data = data; self.status = status; self.delay = delay }

    func fetch(_ request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        do { if delay > 0 { try await Task.sleep(nanoseconds: delay) } }
        catch { cancelled = true; throw error }
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }

    func waitForRequest() async throws {
        for _ in 0..<10_000 {
            if !requests.isEmpty { return }
            await Task.yield()
        }
        throw TestFailure(description: "Transport did not receive a request")
    }
}

@main
private struct NativePlaceLookupTests {
    static func main() async throws {
        try qualifiersAndRanking()
        try validationAndLimits()
        try reverseLookupValidation()
        try await requestsAndFailures()
        try await timeoutAndCancellation()
        print("Native place lookup tests passed")
    }

    static func qualifiersAndRanking() throws {
        var missouri = row(1, state: "Missouri")
        missouri["population"] = 1_000_000
        missouri["feature_code"] = "PPLC"
        let data = try payload([missouri, row(2), row(3, state: "Montana")])
        for query in ["Hardin Kentucky", "Hardin, Kentucky", "Hardin KY", "Hardin, KY, USA", "Hardin Kentucky US", "Hardin, Kentucky United States"] {
            let results = try NativePlaceLookupService.parseSearchResponse(data, query: query)
            try expect(results.map(\.id) == ["2"], "Explicit Kentucky must never return Missouri: \(query)")
        }
        let noMatch = try NativePlaceLookupService.parseSearchResponse(try payload([missouri]), query: "Hardin Kentucky")
        try expect(noMatch.isEmpty, "An unmatched qualifier cannot silently fall back to another state")
        let international = try payload([row(10, name: "Paris", state: "Texas"),
            row(11, name: "Paris", state: "Île-de-France", code: "FR", country: "France")])
        for query in ["Paris France", "Paris, France", "Paris, FR", "Paris, Île-de-France, France"] {
            try expect(try NativePlaceLookupService.parseSearchResponse(international, query: query).map(\.id) == ["11"], "Country qualifier must be honored")
        }
        let berlin = try payload([row(20, name: "Berlin", state: "Berlin", code: "DE", country: "Germany")])
        try expect(try NativePlaceLookupService.parseSearchResponse(berlin, query: "Berlin Germany").first?.countryCode == "DE", "English ISO country names are recognized")
        let ranked = try NativePlaceLookupService.parseSearchResponse(try payload([row(31, name: "Harding"), row(32)]), query: "Hardin")
        try expect(ranked.first?.id == "32", "Exact city name precedes prefix matches")
        let stable = try NativePlaceLookupService.parseSearchResponse(try payload([row(33), row(34)]), query: "Hardin")
        try expect(stable.map(\.id) == ["33", "34"], "Equal-ranked records preserve provider order")
    }

    static func validationAndLimits() throws {
        var invalid: [[String: Any]] = []
        let changes: [(String, Any)] = [("id", 0), ("id", -1), ("id", 9_007_199_254_740_992 as UInt64),
            ("id", "123"), ("id", true), ("latitude", 91), ("longitude", -181), ("latitude", "36.7"),
            ("timezone", "Invalid/Zone"), ("timezone", ""), ("country_code", "ZZ"), ("country_code", "USA"),
            ("country", ""), ("name", ""), ("name", String(repeating: "a", count: 181)), ("name", "Bad\u{0000}Name")]
        for (index, change) in changes.enumerated() { var value = row(index + 100); value[change.0] = change.1; invalid.append(value) }
        var missingTimezone = row(200); missingTimezone.removeValue(forKey: "timezone"); invalid.append(missingTimezone)
        var missingCountry = row(201); missingCountry.removeValue(forKey: "country"); invalid.append(missingCountry)
        let valid = row(42)
        let results = try NativePlaceLookupService.parseSearchResponse(try payload(invalid + [valid, valid]), query: "Hardin")
        try expect(results.count == 1 && results[0].id == "42", "Malformed provider rows are excluded and identities deduplicated")
        try expect(results[0].legacyIDType == "number" && results[0].isValid, "Safe numeric provider identity is preserved")
        try expect(results[0].followsCurrentLocation == false && results[0].alias == nil, "Searched towns are fixed places without aliases")
        let many = try NativePlaceLookupService.parseSearchResponse(try payload((1...30).map { row($0) }), query: "Hardin")
        try expect(many.count == 8, "Display result count is bounded to eight")
        for data in [Data("[]".utf8), Data("{bad".utf8), Data("{\"error\":true}".utf8),
                     Data(repeating: 32, count: 262_145), try payload((1...101).map { row($0) })] {
            do { _ = try NativePlaceLookupService.parseSearchResponse(data, query: "Hardin"); throw TestFailure(description: "Invalid envelope was accepted") }
            catch NativePlaceLookupError.invalidResponse {}
        }
        try expect(try NativePlaceLookupService.parseSearchResponse(Data("{}".utf8), query: "No match").isEmpty, "Provider empty response is supported")
    }

    static func reverseLookupValidation() throws {
        let fallback = NativeManagedPlace(id: "gps-36.763--88.301", name: "Current Location", admin1: "", country: "",
            latitude: 36.7634, longitude: -88.3014, followsCurrentLocation: true)
        let data = Data("{\"address\":{\"town\":\"Hardin\",\"state\":\"Kentucky\",\"country\":\"United States\",\"country_code\":\"us\"}}".utf8)
        let named = NativePlaceLookupService.parseReverseResponse(data, fallback: fallback)
        try expect(named?.name == "Hardin" && named?.countryCode == "US" && named?.isValid == true, "Reverse response yields a validated name")
        try expect(named?.latitude == fallback.latitude && named?.longitude == fallback.longitude && named?.id == fallback.id,
            "Reverse naming cannot replace the authorized fix or its identity")
        try expect(named?.followsCurrentLocation == true, "Explicit current-location intent is retained")
        try expect(NativePlaceLookupService.parseReverseResponse(Data("{\"address\":{\"town\":\"Fake\",\"country_code\":\"ZZ\"}}".utf8), fallback: fallback) == nil,
            "Invalid reverse data cannot mutate the place")
        var fixed = fallback; fixed.followsCurrentLocation = false
        try expect(NativePlaceLookupService.parseReverseResponse(data, fallback: fixed) == nil, "Reverse naming requires an explicitly current-location record")
    }

    static func requestsAndFailures() async throws {
        let transport = FixtureTransport(data: try payload([row(2)]))
        let service = NativePlaceLookupService { try await transport.fetch($0) }
        let results = try await service.search(query: "Hardin Kentucky")
        try expect(results.first?.admin1 == "Kentucky", "Injected native transport returns the parsed result")
        let requests = await transport.requests
        try expect(requests.count == 1, "One matching attempt avoids unnecessary provider calls")
        let request = requests[0]
        let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
        let parameters = Dictionary(uniqueKeysWithValues: components.queryItems!.map { ($0.name, $0.value ?? "") })
        try expect(components.host == "geocoding-api.open-meteo.com" && components.path == "/v1/search", "Uses the existing provider endpoint")
        try expect(parameters["name"] == "Hardin" && parameters["countryCode"] == "US" && parameters["count"] == "100", "Qualified query uses city name, explicit country, and a bounded broader candidate pool")
        try expect(request.timeoutInterval <= 12 && request.cachePolicy == .reloadIgnoringLocalCacheData, "Request deadline and nonpersistent lookup are explicit")
        try expect(try await service.search(query: " ").isEmpty, "Empty searches do not use the network")
        try expect(await transport.requests.count == 1, "Empty searches produce no request")
        for query in [String(repeating: "a", count: 181), "Hardin\nKentucky"] {
            do { _ = try await service.search(query: query); throw TestFailure(description: "Invalid query was accepted") }
            catch NativePlaceLookupError.invalidQuery {}
        }
        let unavailable = FixtureTransport(data: Data(), status: 503)
        do { _ = try await NativePlaceLookupService { try await unavailable.fetch($0) }.search(query: "Hardin"); throw TestFailure(description: "HTTP failure was accepted") }
        catch NativePlaceLookupError.invalidResponse {}
        let redirected = NativePlaceLookupService { _ in
            (Data("{}".utf8), HTTPURLResponse(url: URL(string: "https://unrelated.invalid/search")!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        do { _ = try await redirected.search(query: "Hardin"); throw TestFailure(description: "Unrelated response origin was accepted") }
        catch NativePlaceLookupError.invalidResponse {}
        let privateError = NativePlaceLookupService { _ in throw NSError(domain: "private query or coordinates", code: 1) }
        do { _ = try await privateError.search(query: "Hardin"); throw TestFailure(description: "Transport failure was accepted") }
        catch NativePlaceLookupError.unavailable {}
    }

    static func timeoutAndCancellation() async throws {
        let slow = FixtureTransport(data: try payload([row(2)]), delay: 5_000_000_000)
        let service = NativePlaceLookupService(timeout: 0.02) { try await slow.fetch($0) }
        let start = Date()
        do { _ = try await service.search(query: "Hardin"); throw TestFailure(description: "Slow transport ignored deadline") }
        catch NativePlaceLookupError.timedOut {}
        try expect(Date().timeIntervalSince(start) < 1, "Total timeout cancels an in-flight provider call")
        try expect(await slow.cancelled, "Timeout propagates cancellation into the transport")
        let held = FixtureTransport(data: try payload([row(2)]), delay: 5_000_000_000)
        let cancellable = NativePlaceLookupService { try await held.fetch($0) }
        let task = Task { try await cancellable.search(query: "Hardin Kentucky") }
        try await held.waitForRequest()
        task.cancel()
        do { _ = try await task.value; throw TestFailure(description: "Cancelled query returned places") }
        catch is CancellationError {}
        try expect(await held.cancelled, "User cancellation reaches the native request")
    }
}
