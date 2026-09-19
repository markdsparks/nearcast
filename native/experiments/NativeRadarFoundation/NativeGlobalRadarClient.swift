import Foundation

/// Bounded, memory-only transport for the existing public RainViewer fallback.
/// It follows the web map's four-minute metadata cache without persisting
/// provider responses, cookies, credentials, tile URLs, or selected places.
final class NativeGlobalRadarClient: @unchecked Sendable {
    private let endpoint: URL
    private let configuration: URLSessionConfiguration
    private let cache = NativeGlobalRadarMemoryCache()

    init(endpoint: URL = NativeGlobalRadarContract.metadataEndpoint,
         configuration: URLSessionConfiguration = .ephemeral) {
        self.endpoint = endpoint
        let isolated = configuration.copy() as! URLSessionConfiguration
        isolated.urlCache = nil
        isolated.httpCookieStorage = nil
        isolated.urlCredentialStorage = nil
        isolated.httpShouldSetCookies = false
        isolated.requestCachePolicy = .reloadIgnoringLocalCacheData
        isolated.timeoutIntervalForRequest = 3.5
        isolated.timeoutIntervalForResource = 5
        isolated.httpMaximumConnectionsPerHost = 1
        self.configuration = isolated
    }

    func load(now: Date = Date(), force: Bool = false) async -> NativeGlobalRadarAvailability {
        guard NativeGlobalRadarContract.isAuthorizedMetadataEndpoint(endpoint) else {
            return .unavailable(.unsafeEndpoint)
        }
        if !force, let cached = cache.value(now: now) {
            return NativeGlobalRadarContract.decodeManifest(cached.data, fetchedAt: cached.fetchedAt, now: now)
        }
        do {
            let operation = NativeGlobalRadarMetadataDownload(
                url: endpoint,
                maximumBytes: NativeGlobalRadarContract.maximumMetadataBytes,
                configuration: configuration.copy() as! URLSessionConfiguration
            )
            let data = try await operation.value()
            let availability = NativeGlobalRadarContract.decodeManifest(data, fetchedAt: now, now: now)
            if case .ready = availability { cache.store(data: data, fetchedAt: now) }
            return availability
        } catch is CancellationError {
            return .unavailable(.cancelled)
        } catch NativeGlobalRadarMetadataDownload.Failure.sizeLimit {
            return .unavailable(.responseTooLarge)
        } catch {
            return .unavailable(.transport)
        }
    }
}

private final class NativeGlobalRadarMemoryCache: @unchecked Sendable {
    struct Entry { let data: Data; let fetchedAt: Date }
    private let lock = NSLock()
    private var entry: Entry?

    func value(now: Date) -> Entry? {
        lock.lock(); defer { lock.unlock() }
        guard let entry, now >= entry.fetchedAt,
              now.timeIntervalSince(entry.fetchedAt) < NativeGlobalRadarContract.metadataCacheAge else {
            return nil
        }
        return entry
    }

    func store(data: Data, fetchedAt: Date) {
        lock.lock(); entry = .init(data: data, fetchedAt: fetchedAt); lock.unlock()
    }
}

private final class NativeGlobalRadarMetadataDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    enum Failure: Error { case transport, redirect, status, sizeLimit, unexpectedResponse }

    private let url: URL
    private let maximumBytes: Int
    private let configuration: URLSessionConfiguration
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Data, Error>?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var received = Data()
    private var finished = false

    init(url: URL, maximumBytes: Int, configuration: URLSessionConfiguration) {
        self.url = url
        self.maximumBytes = maximumBytes
        self.configuration = configuration
    }

    func value() async throws -> Data {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation(start)
        } onCancel: {
            self.finish(.failure(CancellationError()))
        }
    }

    private func start(_ continuation: CheckedContinuation<Data, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); continuation.resume(throwing: CancellationError()); return }
        self.continuation = continuation
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 3.5)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        let task = session.dataTask(with: request)
        self.session = session
        self.task = task
        lock.unlock()
        task.resume()
    }

    private func finish(_ result: Result<Data, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let continuation = continuation
        let session = session
        let task = task
        self.continuation = nil
        self.session = nil
        self.task = nil
        received.removeAll(keepingCapacity: false)
        lock.unlock()
        task?.cancel()
        session?.invalidateAndCancel()
        continuation?.resume(with: result)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(Failure.redirect))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, response.url == url else {
            completionHandler(.cancel)
            finish(.failure(Failure.unexpectedResponse))
            return
        }
        guard http.statusCode == 200 else {
            completionHandler(.cancel)
            finish(.failure(Failure.status))
            return
        }
        guard response.expectedContentLength < 0 || response.expectedContentLength <= maximumBytes else {
            completionHandler(.cancel)
            finish(.failure(Failure.sizeLimit))
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        guard data.count <= maximumBytes - received.count else {
            lock.unlock()
            finish(.failure(Failure.sizeLimit))
            return
        }
        received.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            finish(.failure((error as? URLError)?.code == .cancelled
                ? CancellationError() : Failure.transport))
            return
        }
        lock.lock(); let result = received; lock.unlock()
        finish(.success(result))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            completionHandler(.performDefaultHandling, nil)
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}
