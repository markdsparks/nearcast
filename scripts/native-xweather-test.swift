import Foundation

private struct MockReply: Sendable {
    var data: Data
    var status = 200
    var cacheControl = "no-store"
    var contentType = "application/json"
    var contentLength: Int? = nil
}
private final class MockStore: @unchecked Sendable {
    private let lock = NSLock()
    private var reply: MockReply?
    private var count = 0
    private var request: URLRequest?
    func set(_ reply: MockReply) { lock.lock(); self.reply = reply; lock.unlock() }
    func next(_ request: URLRequest) -> MockReply? {
        lock.lock(); defer { lock.unlock() }
        count += 1; self.request = request; return reply
    }
    var calls: Int { lock.lock(); defer { lock.unlock() }; return count }
    var lastRequest: URLRequest? { lock.lock(); defer { lock.unlock() }; return request }
}
private final class MockProtocol: URLProtocol, @unchecked Sendable {
    static let store = MockStore()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let reply = Self.store.next(request), let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return
        }
        var headers = ["Content-Type": reply.contentType, "Cache-Control": reply.cacheControl]
        if let length = reply.contentLength { headers["Content-Length"] = String(length) }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: reply.status,
            httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

@main enum NativeXweatherTests {
    static func main() async throws {
        typealias C = NativeXweatherContract
        let now = ISO8601DateFormatter().date(from: "2026-09-19T00:01:00Z")!
        let surface = C.Surface(isForeground: true, isMapVisible: true, isStormScopeSelected: true,
            isSatellite: false, zoom: 9, activeWeather: true)
        let activation = try C.Activation(clientInstanceID: UUID(), latitude: 38.7, longitude: -89.9,
            requestedAt: now, surface: surface, explicitUserAction: true)
        let lightning = try C.Activation(contextKey: activation.contextKey, clientInstanceID: activation.clientInstanceID,
            latitude: 38.7, longitude: -89.9, requestedAt: now, surface: surface,
            explicitUserAction: true, lightningRequested: true)
        func json(_ object: [String: Any]) -> Data { try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) }
        func payload() -> [String: Any] { [
            "provider": "nearcast-xweather-config", "version": 1, "audience": "app.nearcast.ios",
            "checkedAt": "2026-09-19T00:01:00.000Z", "state": "ready", "reason": "lease-granted",
            "credentials": ["clientId": "fixture-client", "clientSecret": "fixture-secret"],
            "layerCodes": ["radar", "lightning-strikes-icons"],
            "lease": ["id": String(repeating: "a", count: 64), "month": "2026-09",
                      "sessionWindowStart": "2026-09-19T00:00:00.000Z", "expiresAt": "2026-09-19T00:05:00.000Z",
                      "estimatedAccessCost": 150],
            "limits": ["minZoom": 7.5, "requireActiveWeather": true, "sessionAccessCost": 150,
                       "monthlyAccessLimit": 15000, "localMonthlyAccessLimit": 1500, "bypassBudgetChecks": false],
            "context": ["hasViewport": true, "key": activation.contextKey.uuidString.lowercased(), "zoom": 9,
                        "activeWeather": true, "activationRequested": true, "requestedAt": "2026-09-19T00:01:00.000Z"]
        ] }
        func fails(_ expected: C.Failure, _ action: () throws -> Void) {
            do { try action(); preconditionFailure("Expected \(expected)") }
            catch { precondition(error as? C.Failure == expected, "Unexpected failure: \(error)") }
        }
        let permit = try C.decode(json(payload()), activation: activation, now: now)
        precondition(permit.radarAllowed && !permit.lightningAllowed)
        precondition(permit.allowsWork(now: now, surface: surface))
        precondition(!permit.allowsLightning(now: now, surface: surface, explicitLightningRequest: true))
        let lightningPermit = try C.decode(json(payload()), activation: lightning, now: now)
        precondition(lightningPermit.allowsLightning(now: now, surface: surface, explicitLightningRequest: true))
        precondition(!lightningPermit.allowsLightning(now: now, surface: surface, explicitLightningRequest: false))
        precondition(!String(describing: permit).contains("fixture-secret"))
        precondition(!String(reflecting: permit.credentials).contains("fixture-client"))
        precondition(Mirror(reflecting: permit).children.count == 1)
        precondition(!permit.allowsWork(now: now.addingTimeInterval(238), surface: surface))
        precondition(permit.allowsWork(now: now.addingTimeInterval(237), surface: surface))
        precondition(!permit.allowsWork(now: now.addingTimeInterval(-6), surface: surface))

        for key in ["isForeground", "isMapVisible", "isStormScopeSelected", "activeWeather", "isSatellite", "zoom"] {
            var inactive = surface
            switch key {
            case "isForeground": inactive.isForeground = false
            case "isMapVisible": inactive.isMapVisible = false
            case "isStormScopeSelected": inactive.isStormScopeSelected = false
            case "activeWeather": inactive.activeWeather = false
            case "isSatellite": inactive.isSatellite = true
            default: inactive.zoom = 7
            }
            var gate = NativeXweatherSessionGate()
            try gate.activate(permit, now: now, surface: surface)
            precondition(gate.reconcile(now: now, surface: surface))
            precondition(!gate.reconcile(now: now, surface: inactive))
            precondition(gate.permit == nil)
            precondition(!gate.reconcile(now: now, surface: surface), "Stopped sessions must not resume")
        }
        var gate = NativeXweatherSessionGate()
        try gate.activate(permit, now: now, surface: surface)
        precondition(!gate.reconcile(now: now.addingTimeInterval(238), surface: surface))
        gate.stop()
        precondition(gate.permit == nil)

        for key in ["provider", "version", "audience", "checkedAt", "reason"] {
            var bad = payload(); bad[key] = key == "version" ? 2 : "wrong"
            fails(.invalidResponse) { _ = try C.decode(json(bad), activation: activation, now: now) }
        }
        for (container, key, value): (String, String, Any) in [
            ("credentials", "clientSecret", " secret "),
            ("lease", "id", "bad"), ("lease", "estimatedAccessCost", 1),
            ("lease", "sessionWindowStart", "2026-09-19T00:00:01.000Z"),
            ("lease", "expiresAt", "2026-09-19T00:10:00.000Z"),
            ("lease", "month", "2026-08"), ("lease", "budgetBypassed", true),
            ("limits", "bypassBudgetChecks", true), ("limits", "requireActiveWeather", false),
            ("limits", "minZoom", 1), ("limits", "localMonthlyAccessLimit", 0),
            ("context", "key", UUID().uuidString), ("context", "hasViewport", false),
            ("context", "zoom", 8), ("context", "activeWeather", false), ("context", "activationRequested", false)
        ] {
            var bad = payload(), nested = bad[container] as! [String: Any]
            nested[key] = value; bad[container] = nested
            fails(.invalidResponse) { _ = try C.decode(json(bad), activation: activation, now: now) }
        }
        var blocked = payload()
        blocked["state"] = "budget-paused"; blocked["credentials"] = NSNull(); blocked["lease"] = NSNull()
        fails(.unavailable) { _ = try C.decode(json(blocked), activation: activation, now: now) }
        blocked["credentials"] = ["clientId": "fixture-client", "clientSecret": "fixture-secret"]
        fails(.invalidResponse) { _ = try C.decode(json(blocked), activation: activation, now: now) }
        fails(.invalidResponse) { _ = try C.decode(Data(repeating: 32, count: C.maximumBytes + 1), activation: activation, now: now) }
        fails(.explicitActivationRequired) { _ = try C.requestBody(for: activation, now: now.addingTimeInterval(16)) }
        fails(.explicitActivationRequired) {
            _ = try C.Activation(clientInstanceID: UUID(), latitude: 1, longitude: 1, requestedAt: now,
                surface: surface, explicitUserAction: false)
        }
        var tooFar = surface; tooFar.zoom = 8
        fails(.belowMinimumZoom) {
            _ = try C.Activation(clientInstanceID: UUID(), latitude: 1, longitude: 1, requestedAt: now,
                surface: tooFar, explicitUserAction: true, lightningRequested: true)
        }
        let body = try JSONSerialization.jsonObject(with: C.requestBody(for: activation, now: now)) as! [String: Any]
        precondition(body["contextKey"] as? String == activation.contextKey.uuidString.lowercased())
        precondition((body["activation"] as? [String: Any])?["requested"] as? Bool == true)
        precondition((body["client"] as? [String: Any])?["instanceId"] as? String == activation.clientInstanceID.uuidString.lowercased())
        precondition(body["credentials"] == nil && body["place"] == nil)

        precondition(C.isAuthorizedEndpoint(C.endpoint))
        for value in ["http://getnearcast.app/api/xweather/config?client=ios", "https://getnearcast.app/api/xweather/config",
                      "https://getnearcast.app/api/xweather/config?client=web", "https://getnearcast.app.evil.example/api/xweather/config?client=ios",
                      "https://getnearcast.app:443/api/xweather/config?client=ios", "https://getnearcast.app/api/xweather/config?client=ios#fragment"] {
            precondition(!C.isAuthorizedEndpoint(URL(string: value)!))
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockProtocol.self]
        let client = NativeXweatherClient(configuration: configuration, clock: { now })
        MockProtocol.store.set(MockReply(data: json(payload())))
        let received = try await client.authorize(activation)
        precondition(received == permit)
        precondition(MockProtocol.store.calls == 1)
        precondition(MockProtocol.store.lastRequest?.httpMethod == "POST")
        precondition(MockProtocol.store.lastRequest?.url == C.endpoint)
        precondition(MockProtocol.store.lastRequest?.value(forHTTPHeaderField: "Referer") == nil)
        precondition(MockProtocol.store.lastRequest?.value(forHTTPHeaderField: "Authorization") == nil)
        for reply in [MockReply(data: json(payload()), status: 403),
                      MockReply(data: json(payload()), cacheControl: "public"),
                      MockReply(data: json(payload()), contentType: "text/html"),
                      MockReply(data: Data(repeating: 32, count: C.maximumBytes + 1)),
                      MockReply(data: json(payload()), contentLength: C.maximumBytes + 1)] {
            let before = MockProtocol.store.calls
            MockProtocol.store.set(reply)
            do { _ = try await client.authorize(activation); preconditionFailure("Unsafe response accepted") }
            catch { precondition(error is C.Failure) }
            precondition(MockProtocol.store.calls == before + 1, "No automatic retries")
        }
        let before = MockProtocol.store.calls
        do {
            _ = try await NativeXweatherClient(endpoint: URL(string: "https://evil.example/")!,
                configuration: configuration, clock: { now }).authorize(activation)
            preconditionFailure("Unsafe endpoint accepted")
        } catch { precondition(error as? C.Failure == .unsafeEndpoint) }
        precondition(MockProtocol.store.calls == before)
        print("PASS native Xweather explicit activation, audience, lease, lifecycle, redaction and bounded no-retry client")
    }
}
