import Foundation

/// Fetches existing published chunk indexes and individual NCRD payloads only.
/// Origins must be explicitly supplied by the host app from its approved source
/// configuration; manifests cannot introduce another origin, credentials, a
/// redirect, or a browser blob URL. No persistent cache/cookies/credentials.
final class RadarChunkClient: @unchecked Sendable {
    struct LoadedManifest: Sendable {
        let url: URL
        let manifest: RadarChunkContract.Manifest
    }

    private let allowedOrigins: Set<String>
    private let configuration: URLSessionConfiguration
    private let admission = RadarDownloadAdmission()

    init(allowedOrigins: [URL], configuration: URLSessionConfiguration = .ephemeral) throws {
        guard !allowedOrigins.isEmpty, allowedOrigins.count <= 8 else { throw RadarChunkContract.Failure.unsafeURL }
        for url in allowedOrigins { try RadarChunkContract.validateHTTPS(url) }
        self.allowedOrigins = Set(allowedOrigins.map(RadarChunkContract.origin))
        let isolated = configuration.copy() as! URLSessionConfiguration
        isolated.urlCache = nil
        isolated.httpCookieStorage = nil
        isolated.urlCredentialStorage = nil
        isolated.httpShouldSetCookies = false
        // A caller-supplied test/session configuration must not smuggle auth or
        // cookie headers into the public source transport.
        isolated.httpAdditionalHeaders = nil
        isolated.requestCachePolicy = .reloadIgnoringLocalCacheData
        isolated.timeoutIntervalForRequest = 20
        isolated.timeoutIntervalForResource = 30
        isolated.httpMaximumConnectionsPerHost = 2
        self.configuration = isolated
    }

    func loadManifest(at url: URL) async throws -> LoadedManifest {
        try authorize(url)
        let data = try await download(url, maximumBytes: RadarChunkContract.maximumManifestBytes)
        try Task.checkCancellation()
        return .init(url: url, manifest: try RadarChunkContract.decodeManifest(data))
    }

    /// Shared bounded transport for the existing direct MRMS/HRRR adapters.
    /// It grants no additional origins and never logs request URLs/credentials.
    func fetchBytes(at url: URL, maximumBytes: Int) async throws -> Data {
        guard (1...(16 * 1_024 * 1_024)).contains(maximumBytes) else { throw RadarChunkContract.Failure.sizeLimit }
        try authorize(url)
        return try await download(url, maximumBytes: maximumBytes)
    }

    func fetchRange(at url: URL, range: ClosedRange<Int>) async throws -> Data {
        guard range.lowerBound >= 0, range.upperBound < 2_000_000_000,
              range.count <= 4 * 1024 * 1024 else { throw RadarChunkContract.Failure.sizeLimit }
        try authorize(url); try Task.checkCancellation(); try admission.enter()
        defer { admission.leave() }
        return try await BoundedRadarChunkDownload(url: url, maximumBytes: range.count,
            configuration: configuration.copy() as! URLSessionConfiguration, range: range).value()
    }

    func loadChunk(_ descriptor: RadarChunkContract.Descriptor, from loaded: LoadedManifest) async throws -> RadarChunkContract.DecodedChunk {
        try authorize(loaded.url)
        guard loaded.manifest.descriptors.contains(descriptor) else { throw RadarChunkContract.Failure.inconsistentMetadata }
        let url = try RadarChunkContract.resolve(descriptor, relativeTo: loaded.url)
        try authorize(url)
        let data = try await download(url, maximumBytes: descriptor.byteLength)
        try Task.checkCancellation()
        return try RadarChunkContract.decodeChunk(data, descriptor: descriptor, manifest: loaded.manifest)
    }

    private func authorize(_ url: URL) throws {
        try RadarChunkContract.validateHTTPS(url)
        guard allowedOrigins.contains(RadarChunkContract.origin(url)) else { throw RadarChunkContract.Failure.unsafeURL }
    }

    private func download(_ url: URL, maximumBytes: Int) async throws -> Data {
        try Task.checkCancellation()
        try admission.enter()
        defer { admission.leave() }
        // One operation owns one short-lived ephemeral session. Cancellation
        // invalidates it, so late callbacks cannot publish a stale partial frame.
        let operation = BoundedRadarChunkDownload(url: url, maximumBytes: maximumBytes,
                                                configuration: configuration.copy() as! URLSessionConfiguration)
        return try await operation.value()
    }
}

private final class RadarDownloadAdmission: @unchecked Sendable {
    private let lock = NSLock()
    private var active = 0
    func enter() throws {
        lock.lock(); defer { lock.unlock() }
        guard active < 2 else { throw RadarChunkContract.Failure.requestLimit }
        active += 1
    }
    func leave() { lock.lock(); active -= 1; lock.unlock() }
}

/// All mutable state is protected by the lock; delegate callbacks may arrive on
/// arbitrary URLSession queues. Continuations resume exactly once, outside lock.
private final class BoundedRadarChunkDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let url: URL
    private let maximumBytes: Int
    private let configuration: URLSessionConfiguration
    private let range: ClosedRange<Int>?
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Data, Error>?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var received = Data()
    private var finished = false

    init(url: URL, maximumBytes: Int, configuration: URLSessionConfiguration, range: ClosedRange<Int>? = nil) {
        self.url = url
        self.maximumBytes = maximumBytes
        self.configuration = configuration
        self.range = range
    }

    func value() async throws -> Data {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { start($0) }
        } onCancel: {
            self.finish(.failure(CancellationError()))
        }
    }

    private func start(_ continuation: CheckedContinuation<Data, Error>) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return
        }
        self.continuation = continuation
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = "GET"
        if let range { request.setValue("bytes=\(range.lowerBound)-\(range.upperBound)", forHTTPHeaderField: "Range") }
        request.setValue("application/json, application/vnd.nearcast.radar-chunk, application/octet-stream, application/gzip", forHTTPHeaderField: "Accept")
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
        let continuation = self.continuation
        let session = self.session
        let task = self.task
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
        finish(.failure(RadarChunkContract.Failure.redirect))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, response.url == url else {
            completionHandler(.cancel)
            finish(.failure(RadarChunkContract.Failure.unexpectedResponse))
            return
        }
        guard http.statusCode == (range == nil ? 200 : 206) else {
            completionHandler(.cancel)
            finish(.failure(RadarChunkContract.Failure.httpStatus(http.statusCode)))
            return
        }
        if let range {
            let prefix = "bytes \(range.lowerBound)-\(range.upperBound)/"
            guard let header = http.value(forHTTPHeaderField: "Content-Range"), header.hasPrefix(prefix),
                  let total = Int(header.dropFirst(prefix.count)), total > range.upperBound else {
                completionHandler(.cancel); finish(.failure(RadarChunkContract.Failure.unexpectedResponse)); return
            }
        }
        guard response.expectedContentLength <= maximumBytes else {
            completionHandler(.cancel)
            finish(.failure(RadarChunkContract.Failure.sizeLimit))
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        guard data.count <= maximumBytes - received.count else {
            lock.unlock()
            finish(.failure(RadarChunkContract.Failure.sizeLimit))
            return
        }
        received.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            // Provider URLs and localized URLSession errors are not propagated
            // into diagnostics: they may contain signed query parameters.
            finish(.failure((error as? URLError)?.code == .cancelled
                ? CancellationError() : RadarChunkContract.Failure.transport))
            return
        }
        lock.lock()
        let result = received
        lock.unlock()
        if let range, result.count != range.count {
            finish(.failure(RadarChunkContract.Failure.unexpectedResponse)); return
        }
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
