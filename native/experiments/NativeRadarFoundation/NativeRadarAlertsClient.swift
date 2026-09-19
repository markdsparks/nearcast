import Foundation

/// Dedicated public NWS request: required application User-Agent and GeoJSON
/// Accept header, one in-flight request, bounded streaming bytes, no redirects,
/// cookies, credentials, persistence, generated location/state lookup or retries.
actor NativeRadarAlertsClient {
    private let configuration: URLSessionConfiguration
    private var busy = false
    private struct ViewportFeed: Sendable {
        let pages: [Data]
        let checkedAt: Date
        let complete: Bool
    }
    private var viewportFeed: ViewportFeed?

    init(configuration: URLSessionConfiguration = .ephemeral) {
        let isolated = configuration.copy() as! URLSessionConfiguration
        isolated.urlCache = nil
        isolated.httpCookieStorage = nil
        isolated.urlCredentialStorage = nil
        isolated.httpShouldSetCookies = false
        isolated.httpAdditionalHeaders = nil
        isolated.requestCachePolicy = .reloadIgnoringLocalCacheData
        isolated.timeoutIntervalForRequest = 12
        isolated.timeoutIntervalForResource = 20
        isolated.httpMaximumConnectionsPerHost = 1
        self.configuration = isolated
    }

    func load(scope: NativeRadarAlertsContract.Scope, now: Date = Date()) async throws -> NativeRadarAlertsContract.Snapshot {
        try Task.checkCancellation()
        guard now.timeIntervalSince1970.isFinite else { throw NativeRadarAlertsContract.Failure.invalidTime }
        guard scope.isSupported else {
            return .init(scope: scope, checkedAt: nil, quality: .unsupported, rejectedFeatureCount: 0, alerts: [])
        }
        guard !busy else { throw NativeRadarAlertsContract.Failure.requestInFlight }
        busy = true
        defer { busy = false }
        let operation = NativeRadarAlertsDownload(url: scope.url, configuration: configuration.copy() as! URLSessionConfiguration)
        let data = try await operation.value()
        try Task.checkCancellation()
        return try NativeRadarAlertsContract.decode(data, scope: scope, now: now)
    }

    /// NWS has no bbox alert endpoint. Read its active feed under fixed byte,
    /// page, feature, and elapsed-time caps, then intersect official polygons.
    /// Cache the bounded raw feed only in memory so settled camera moves do not
    /// trigger a nationwide request each time. A separate point client should
    /// retain the selected place's bulletin-only county/zone alerts.
    func loadViewport(viewport: NativeRadarAlertsContract.Viewport,
                      selectedPlace: NativeRadarAlertsContract.Point? = nil,
                      countryCode: String? = "US", now: Date = Date(), forceRefresh: Bool = false) async throws -> NativeRadarAlertsContract.ViewportSnapshot {
        typealias C = NativeRadarAlertsContract
        try Task.checkCancellation()
        guard now.timeIntervalSince1970.isFinite else { throw C.Failure.invalidTime }
        let scope = try C.Scope.viewport(viewport, selectedPlace: selectedPlace, countryCode: countryCode)
        if !scope.isSupported {
            return try C.decodeViewport([], scope: scope, checkedAt: now, now: now, transportComplete: true)
        }
        if !forceRefresh, let feed = viewportFeed, feed.checkedAt <= now,
           now.timeIntervalSince(feed.checkedAt) < (feed.complete ? 300 : 30) {
            return try C.decodeViewport(feed.pages, scope: scope, checkedAt: feed.checkedAt, now: now,
                                        transportComplete: feed.complete, wasCached: true)
        }
        guard !busy else { throw C.Failure.requestInFlight }
        busy = true
        defer { busy = false }
        let started = Date()
        var pages: [Data] = [], visited: Set<URL> = [], url: URL? = scope.url
        var totalBytes = 0, featureCount = 0, complete = false
        while let next = url {
            try Task.checkCancellation()
            let remainingTime = 20 - Date().timeIntervalSince(started)
            guard remainingTime > 0, pages.count < C.maximumViewportPages,
                  totalBytes < C.maximumViewportBytes, featureCount < C.maximumViewportFeatures,
                  visited.insert(next).inserted else { break }
            do {
                let operation = NativeRadarAlertsDownload(url: next, configuration: configuration.copy() as! URLSessionConfiguration,
                    maximumBytes: min(C.maximumBytes, C.maximumViewportBytes - totalBytes), timeout: min(12, remainingTime))
                let data = try await operation.value()
                try Task.checkCancellation()
                let count = try C.viewportFeatureCount(data)
                pages.append(data); totalBytes += data.count; featureCount += count
                // A malformed continuation does not discard already-validated
                // bulletins, but it explicitly prevents a completeness claim.
                url = try C.viewportNextPage(data)
                if url == nil { complete = featureCount <= C.maximumViewportFeatures; break }
            } catch {
                if error is CancellationError || Task.isCancelled { throw CancellationError() }
                if pages.isEmpty { throw error }
                break
            }
        }
        try Task.checkCancellation()
        guard !pages.isEmpty else { throw C.Failure.transport }
        let result = try C.decodeViewport(pages, scope: scope, checkedAt: now, now: now, transportComplete: complete)
        // Do not cache a cancellation or empty failed load. A fully downloaded
        // feed is reused for five minutes even if some source products are
        // rejected; panning must not hammer NWS because of an expired bulletin.
        // Interrupted/truncated downloads have a shorter retry window.
        viewportFeed = ViewportFeed(pages: pages, checkedAt: now, complete: complete)
        return result
    }
}

/// Delegate state is locked; a cancellation or late callback resumes at most
/// once. Cancelling the caller also cancels the underlying network request.
private final class NativeRadarAlertsDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let url: URL
    private let configuration: URLSessionConfiguration
    private let maximumBytes: Int
    private let timeout: TimeInterval
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Data, Error>?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var bytes = Data()
    private var finished = false

    init(url: URL, configuration: URLSessionConfiguration,
         maximumBytes: Int = NativeRadarAlertsContract.maximumBytes, timeout: TimeInterval = 12) {
        self.url = url; self.configuration = configuration; self.maximumBytes = maximumBytes; self.timeout = timeout
    }

    func value() async throws -> Data {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { start($0) }
        } onCancel: { self.finish(.failure(CancellationError())) }
    }

    private func start(_ continuation: CheckedContinuation<Data, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); continuation.resume(throwing: CancellationError()); return }
        self.continuation = continuation
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = "GET"
        request.setValue("application/geo+json", forHTTPHeaderField: "Accept")
        request.setValue("Nearcast/1.0 (https://getnearcast.app)", forHTTPHeaderField: "User-Agent")
        let task = session.dataTask(with: request)
        self.session = session; self.task = task
        lock.unlock()
        task.resume()
    }

    private func finish(_ result: Result<Data, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let continuation = self.continuation, session = self.session, task = self.task
        self.continuation = nil; self.session = nil; self.task = nil
        bytes.removeAll(keepingCapacity: false)
        lock.unlock()
        task?.cancel(); session?.invalidateAndCancel()
        continuation?.resume(with: result)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(NativeRadarAlertsContract.Failure.redirect))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse, response.url == url else {
            completionHandler(.cancel); finish(.failure(NativeRadarAlertsContract.Failure.transport)); return
        }
        guard response.statusCode == 200 else {
            completionHandler(.cancel); finish(.failure(NativeRadarAlertsContract.Failure.httpStatus(response.statusCode))); return
        }
        guard response.expectedContentLength <= maximumBytes else {
            completionHandler(.cancel); finish(.failure(NativeRadarAlertsContract.Failure.sizeLimit)); return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        guard data.count <= maximumBytes - bytes.count else {
            lock.unlock(); finish(.failure(NativeRadarAlertsContract.Failure.sizeLimit)); return
        }
        bytes.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            finish(.failure((error as? URLError)?.code == .cancelled ? CancellationError() : NativeRadarAlertsContract.Failure.transport))
            return
        }
        lock.lock(); let result = bytes; lock.unlock()
        finish(.success(result))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
    }
}
