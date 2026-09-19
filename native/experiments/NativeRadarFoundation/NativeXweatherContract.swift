import Foundation

/// Native StormScope is opt-in. A valid server lease is permission to create a
/// provider layer, not a weather observation and not a background entitlement.
enum NativeXweatherContract {
    static let endpoint = URL(string: "https://getnearcast.app/api/xweather/config?client=ios")!
    static let audience = "app.nearcast.ios"
    static let maximumBytes = 32 * 1_024
    static let minimumZoom = 7.5
    static let lightningMinimumZoom = 8.5
    static let expiryMargin: TimeInterval = 2

    enum Failure: Error, Equatable, Sendable {
        case unsafeEndpoint, explicitActivationRequired, inactiveSurface, invalidViewport
        case noActiveWeather, belowMinimumZoom, invalidResponse, unavailable
        case expired, cancelled, transport, responseTooLarge
    }

    struct Surface: Equatable, Sendable {
        var isForeground: Bool
        var isMapVisible: Bool
        var isStormScopeSelected: Bool
        var isSatellite: Bool
        var zoom: Double
        var activeWeather: Bool

        var permitsProviderWork: Bool {
            isForeground && isMapVisible && isStormScopeSelected && !isSatellite &&
                zoom.isFinite && zoom >= minimumZoom && zoom <= 22 && activeWeather
        }
    }

    struct Activation: Equatable, Sendable {
        let contextKey: UUID
        let clientInstanceID: UUID
        let latitude: Double
        let longitude: Double
        let zoom: Double
        let requestedAt: Date
        let lightningRequested: Bool

        /// Construct only for a direct user action, never in onAppear, restore,
        /// map pan, automatic refresh, background wake or permission callback.
        init(contextKey: UUID = UUID(), clientInstanceID: UUID, latitude: Double, longitude: Double,
             requestedAt: Date, surface: Surface, explicitUserAction: Bool,
             lightningRequested: Bool = false) throws {
            guard explicitUserAction else { throw Failure.explicitActivationRequired }
            guard surface.isForeground && surface.isMapVisible && surface.isStormScopeSelected && !surface.isSatellite else {
                throw Failure.inactiveSurface
            }
            guard latitude.isFinite, longitude.isFinite, abs(latitude) <= 85.051129, abs(longitude) <= 180,
                  surface.zoom.isFinite, surface.zoom <= 22, requestedAt.timeIntervalSince1970.isFinite else {
                throw Failure.invalidViewport
            }
            guard surface.activeWeather else { throw Failure.noActiveWeather }
            guard surface.zoom >= minimumZoom,
                  !lightningRequested || surface.zoom >= lightningMinimumZoom else { throw Failure.belowMinimumZoom }
            self.contextKey = contextKey
            self.clientInstanceID = clientInstanceID
            self.latitude = latitude
            self.longitude = longitude
            self.zoom = surface.zoom
            self.requestedAt = requestedAt
            self.lightningRequested = lightningRequested
        }
    }

    /// Deliberately not Codable. Provider credentials may exist only in memory.
    struct Credentials: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
        let clientID: String
        let clientSecret: String
        var description: String { "NativeXweatherCredentials(<redacted>)" }
        var debugDescription: String { description }
        var customMirror: Mirror { Mirror(self, children: ["credentials": "<redacted>"]) }
    }

    struct Permit: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
        let contextKey: UUID
        let credentials: Credentials
        let leaseID: String
        let startsAt: Date
        let expiresAt: Date
        let checkedAt: Date
        let minimumZoom: Double
        let radarAllowed: Bool
        let lightningAllowed: Bool
        let estimatedAccessCost: Int

        var description: String { "NativeXweatherPermit(credentials and lease: <redacted>)" }
        var debugDescription: String { description }
        var customMirror: Mirror { Mirror(self, children: ["permit": "<redacted>"]) }

        func allowsWork(now: Date, surface: Surface) -> Bool {
            let timestamp = now.timeIntervalSince1970
            return timestamp.isFinite && surface.permitsProviderWork && surface.zoom >= minimumZoom &&
                now >= startsAt && now >= checkedAt.addingTimeInterval(-5) &&
                now < expiresAt.addingTimeInterval(-NativeXweatherContract.expiryMargin)
        }

        func allowsLightning(now: Date, surface: Surface, explicitLightningRequest: Bool) -> Bool {
            lightningAllowed && explicitLightningRequest && surface.zoom >= NativeXweatherContract.lightningMinimumZoom &&
                allowsWork(now: now, surface: surface)
        }
    }

    static func isAuthorizedEndpoint(_ url: URL) -> Bool {
        guard let value = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return value.scheme == "https" && value.host == "getnearcast.app" && value.port == nil &&
            value.user == nil && value.password == nil && value.path == "/api/xweather/config" &&
            value.fragment == nil && value.queryItems == [URLQueryItem(name: "client", value: "ios")]
    }

    static func requestBody(for activation: Activation, now: Date) throws -> Data {
        let age = now.timeIntervalSince(activation.requestedAt)
        guard age.isFinite, age >= 0, age <= 15 else { throw Failure.explicitActivationRequired }
        return try JSONSerialization.data(withJSONObject: [
            "provider": "nearcast-xweather-config-request", "version": 1,
            "contextKey": activation.contextKey.uuidString.lowercased(),
            "viewport": ["center": ["latitude": activation.latitude, "longitude": activation.longitude],
                         "zoom": activation.zoom],
            "storm": ["activeWeather": true, "activeWeatherReason": "native-observed-radar"],
            "activation": ["requested": true, "source": "native-user-action"],
            "client": ["instanceId": activation.clientInstanceID.uuidString.lowercased()]
        ], options: [.sortedKeys])
    }

    private struct Wire: Decodable {
        struct Credential: Decodable { let clientId: String; let clientSecret: String }
        struct Lease: Decodable {
            let id: String; let month: String; let sessionWindowStart: String; let expiresAt: String
            let estimatedAccessCost: Int; let budgetBypassed: Bool?
        }
        struct Limits: Decodable {
            let minZoom: Double; let requireActiveWeather: Bool; let sessionAccessCost: Int
            let monthlyAccessLimit: Int; let localMonthlyAccessLimit: Int; let bypassBudgetChecks: Bool
        }
        struct Context: Decodable {
            let hasViewport: Bool; let key: String; let zoom: Double
            let activeWeather: Bool; let activationRequested: Bool; let requestedAt: String
        }
        let provider: String; let version: Int; let audience: String; let checkedAt: String
        let state: String; let reason: String; let credentials: Credential?
        let layerCodes: [String]; let lease: Lease?; let limits: Limits; let context: Context
    }

    static func decode(_ data: Data, activation: Activation, now: Date) throws -> Permit {
        guard !data.isEmpty, data.count <= maximumBytes,
              let wire = try? JSONDecoder().decode(Wire.self, from: data),
              wire.provider == "nearcast-xweather-config", wire.version == 1, wire.audience == audience else {
            throw Failure.invalidResponse
        }
        guard wire.state == "ready" else {
            guard wire.credentials == nil, wire.lease == nil else { throw Failure.invalidResponse }
            throw Failure.unavailable
        }
        guard ["lease-granted", "lease-reused"].contains(wire.reason),
              let credentials = wire.credentials, validSecret(credentials.clientId), validSecret(credentials.clientSecret),
              let lease = wire.lease, lease.id.count == 64,
              lease.id.allSatisfy({ $0.isASCII && ($0.isHexDigit && !$0.isUppercase) }),
              lease.budgetBypassed != true, !wire.limits.bypassBudgetChecks,
              wire.limits.requireActiveWeather,
              wire.limits.minZoom.isFinite, wire.limits.minZoom >= minimumZoom, wire.limits.minZoom <= 22,
              wire.limits.sessionAccessCost == 150, lease.estimatedAccessCost == 150,
              wire.limits.localMonthlyAccessLimit >= 150,
              wire.limits.monthlyAccessLimit >= wire.limits.localMonthlyAccessLimit,
              wire.context.hasViewport, wire.context.activeWeather, wire.context.activationRequested,
              wire.context.key == activation.contextKey.uuidString.lowercased(),
              wire.context.zoom.isFinite, abs(wire.context.zoom - activation.zoom) <= 0.006,
              wire.context.zoom >= wire.limits.minZoom,
              wire.layerCodes.count <= 16, Set(wire.layerCodes).count == wire.layerCodes.count,
              wire.layerCodes.contains("radar"),
              let checked = date(wire.checkedAt), let requested = date(wire.context.requestedAt),
              let starts = date(lease.sessionWindowStart), let ends = date(lease.expiresAt),
              now.timeIntervalSince1970.isFinite else { throw Failure.invalidResponse }
        let start = starts.timeIntervalSince1970
        let age = now.timeIntervalSince(checked)
        guard start >= 0, abs(start - floor(start / 300) * 300) < 0.001,
              abs(ends.timeIntervalSince(starts) - 300) < 0.001,
              lease.month == String(lease.sessionWindowStart.prefix(7)),
              requested >= starts, requested < ends, checked >= requested,
              checked.timeIntervalSince(requested) <= 15,
              age >= -5, age <= 30,
              now.timeIntervalSince(activation.requestedAt) >= 0,
              now.timeIntervalSince(activation.requestedAt) <= 30 else { throw Failure.invalidResponse }
        guard now >= starts, now < ends.addingTimeInterval(-expiryMargin) else { throw Failure.expired }
        return Permit(contextKey: activation.contextKey,
            credentials: Credentials(clientID: credentials.clientId, clientSecret: credentials.clientSecret),
            leaseID: lease.id, startsAt: starts, expiresAt: ends, checkedAt: checked,
            minimumZoom: wire.limits.minZoom, radarAllowed: true,
            lightningAllowed: activation.lightningRequested && wire.layerCodes.contains("lightning-strikes-icons"),
            estimatedAccessCost: lease.estimatedAccessCost)
    }

    private static func validSecret(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 512 && value.unicodeScalars.allSatisfy { $0.value > 32 && $0.value < 127 }
    }
    private static func date(_ value: String) -> Date? {
        guard value.utf8.count <= 32, value.hasSuffix("Z") else { return nil }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = parser.date(from: value) { return date }
        parser.formatOptions = [.withInternetDateTime]
        return parser.date(from: value)
    }
}

/// Lifecycle policy is independently testable without creating a provider SDK
/// or session. Once stopped, it never resumes or renews by itself.
struct NativeXweatherSessionGate: Sendable {
    private(set) var permit: NativeXweatherContract.Permit?
    mutating func activate(_ value: NativeXweatherContract.Permit, now: Date,
                           surface: NativeXweatherContract.Surface) throws {
        guard value.allowsWork(now: now, surface: surface) else { throw NativeXweatherContract.Failure.expired }
        permit = value
    }
    @discardableResult mutating func reconcile(now: Date, surface: NativeXweatherContract.Surface) -> Bool {
        guard let permit, permit.allowsWork(now: now, surface: surface) else { self.permit = nil; return false }
        return true
    }
    mutating func stop() { permit = nil }
}
