import Foundation

/// Contacts only Nearcast's existing configuration route, never Xweather.
/// Loading this type does not request a lease. Each authorize call represents
/// one explicit user action; failures are never retried automatically.
final class NativeXweatherClient: @unchecked Sendable {
    typealias Clock = @Sendable () -> Date
    private let endpoint: URL
    private let configuration: URLSessionConfiguration
    private let clock: Clock

    init(endpoint: URL = NativeXweatherContract.endpoint,
         configuration: URLSessionConfiguration = .ephemeral,
         clock: @escaping Clock = { Date() }) {
        self.endpoint = endpoint
        self.clock = clock
        let isolated = configuration.copy() as! URLSessionConfiguration
        isolated.urlCache = nil
        isolated.httpCookieStorage = nil
        isolated.urlCredentialStorage = nil
        isolated.httpShouldSetCookies = false
        isolated.httpAdditionalHeaders = nil
        isolated.requestCachePolicy = .reloadIgnoringLocalCacheData
        isolated.timeoutIntervalForRequest = 8
        isolated.timeoutIntervalForResource = 10
        isolated.httpMaximumConnectionsPerHost = 1
        self.configuration = isolated
    }

    func authorize(_ activation: NativeXweatherContract.Activation) async throws -> NativeXweatherContract.Permit {
        try Task.checkCancellation()
        guard NativeXweatherContract.isAuthorizedEndpoint(endpoint) else {
            throw NativeXweatherContract.Failure.unsafeEndpoint
        }
        let body = try NativeXweatherContract.requestBody(for: activation, now: clock())
        let download = NativeXweatherConfigurationDownload(url: endpoint, body: body,
            configuration: configuration.copy() as! URLSessionConfiguration)
        let data = try await download.value()
        try Task.checkCancellation()
        return try NativeXweatherContract.decode(data, activation: activation, now: clock())
    }
}

private final class NativeXweatherConfigurationDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let url: URL
    private let body: Data
    private let configuration: URLSessionConfiguration
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Data, Error>?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var received = Data()
    private var finished = false

    init(url: URL, body: Data, configuration: URLSessionConfiguration) {
        self.url = url; self.body = body; self.configuration = configuration
    }

    func value() async throws -> Data {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation(start)
        } onCancel: { self.finish(.failure(CancellationError())) }
    }

    private func start(_ continuation: CheckedContinuation<Data, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); continuation.resume(throwing: CancellationError()); return }
        self.continuation = continuation
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
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
        received.removeAll(keepingCapacity: false)
        lock.unlock()
        task?.cancel()
        session?.invalidateAndCancel()
        continuation?.resume(with: result)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(NativeXweatherContract.Failure.transport))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, response.url == url, http.statusCode == 200,
              http.mimeType?.lowercased() == "application/json",
              http.value(forHTTPHeaderField: "Cache-Control")?.lowercased().split(separator: ",")
                .map({ $0.trimmingCharacters(in: .whitespaces) }).contains("no-store") == true else {
            completionHandler(.cancel)
            finish(.failure(NativeXweatherContract.Failure.transport)); return
        }
        guard response.expectedContentLength < 0 || response.expectedContentLength <= NativeXweatherContract.maximumBytes else {
            completionHandler(.cancel)
            finish(.failure(NativeXweatherContract.Failure.responseTooLarge)); return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        guard data.count <= NativeXweatherContract.maximumBytes - received.count else {
            lock.unlock(); finish(.failure(NativeXweatherContract.Failure.responseTooLarge)); return
        }
        received.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            finish(.failure((error as? URLError)?.code == .cancelled ? CancellationError() : NativeXweatherContract.Failure.transport))
            return
        }
        lock.lock(); let data = received; lock.unlock()
        finish(.success(data))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            completionHandler(.performDefaultHandling, nil)
        } else { completionHandler(.cancelAuthenticationChallenge, nil) }
    }
}
