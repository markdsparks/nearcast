import Foundation

/// Dedicated public NWS request: required application User-Agent and GeoJSON
/// Accept header, one in-flight request, bounded streaming bytes, no redirects,
/// cookies, credentials, persistence, generated location/state lookup or retries.
actor NativeRadarAlertsClient {
    private let configuration: URLSessionConfiguration
    private var busy = false

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
}

/// Delegate state is locked; a cancellation or late callback resumes at most
/// once. Cancelling the caller also cancels the underlying network request.
private final class NativeRadarAlertsDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let url: URL
    private let configuration: URLSessionConfiguration
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Data, Error>?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var bytes = Data()
    private var finished = false

    init(url: URL, configuration: URLSessionConfiguration) { self.url = url; self.configuration = configuration }

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
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
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
        guard response.expectedContentLength <= NativeRadarAlertsContract.maximumBytes else {
            completionHandler(.cancel); finish(.failure(NativeRadarAlertsContract.Failure.sizeLimit)); return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        guard data.count <= NativeRadarAlertsContract.maximumBytes - bytes.count else {
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
