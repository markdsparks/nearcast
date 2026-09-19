import Foundation

/// Resolves an actual recent local GIBS pass instead of assuming today's daily
/// layer is populated at the selected place. At most eight sequential probes:
/// UTC today through three days ago, Aqua then Terra, matching the web map.
final class NativeSatelliteClient: @unchecked Sendable {
    private let configuration: URLSessionConfiguration

    init(configuration: URLSessionConfiguration = .ephemeral) {
        let isolated = configuration.copy() as! URLSessionConfiguration
        isolated.urlCache = nil
        isolated.httpCookieStorage = nil
        isolated.urlCredentialStorage = nil
        isolated.httpShouldSetCookies = false
        isolated.requestCachePolicy = .reloadIgnoringLocalCacheData
        isolated.timeoutIntervalForRequest = 4.5
        isolated.timeoutIntervalForResource = 6
        isolated.httpMaximumConnectionsPerHost = 1
        self.configuration = isolated
    }

    func resolveLatestAvailable(latitude: Double, longitude: Double,
                                now: Date = Date()) async -> NativeSatelliteAvailability {
        guard let tile = NativeSatelliteContract.probeTile(latitude: latitude, longitude: longitude) else {
            return .unavailable(.invalidCoordinate)
        }
        var rememberedFailure: NativeSatelliteUnavailableReason?
        var probeCount = 0
        for daysAgo in 0...3 {
            guard let date = NativeSatelliteAcquisitionDate.daysAgo(daysAgo, from: now) else {
                return .unavailable(.invalidResponse)
            }
            for product in NativeSatelliteProduct.allCases {
                do { try Task.checkCancellation() }
                catch { return .unavailable(.cancelled) }
                probeCount += 1
                guard probeCount <= NativeSatelliteContract.maximumProbeCount,
                      let url = NativeSatelliteContract.probeURL(product: product, date: date, tile: tile),
                      NativeSatelliteContract.isAuthorizedTileURL(url) else {
                    return .unavailable(.invalidResponse)
                }
                do {
                    let response = try await NativeSatelliteProbeDownload(
                        url: url, maximumBytes: NativeSatelliteContract.maximumProbeBytes,
                        configuration: configuration.copy() as! URLSessionConfiguration
                    ).value()
                    guard NativeSatelliteContract.acceptsProbe(
                        data: response.data,
                        mimeType: response.mimeType,
                        requestedProduct: product,
                        requestedDate: date,
                        requestedLayerHeader: response.requestedLayer,
                        actualLayerHeader: response.actualLayer,
                        requestedTimeHeader: response.requestedTime,
                        actualTimeHeader: response.actualTime
                    ) else {
                        rememberedFailure = .invalidResponse
                        continue
                    }
                    return .ready(NativeSatelliteContract.descriptor(product: product, date: date))
                } catch is CancellationError {
                    return .unavailable(.cancelled)
                } catch NativeSatelliteProbeDownload.Failure.notAvailable {
                    continue
                } catch NativeSatelliteProbeDownload.Failure.sizeLimit {
                    rememberedFailure = .responseTooLarge
                } catch {
                    if rememberedFailure == nil { rememberedFailure = .transport }
                }
            }
        }
        return .unavailable(rememberedFailure ?? .noRecentLocalPass)
    }
}

private struct NativeSatelliteProbeResponse: Sendable {
    let data: Data
    let mimeType: String?
    let requestedLayer: String?
    let actualLayer: String?
    let requestedTime: String?
    let actualTime: String?
}

private final class NativeSatelliteProbeDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    enum Failure: Error { case transport, redirect, notAvailable, status, sizeLimit, unexpectedResponse }

    private let url: URL
    private let maximumBytes: Int
    private let configuration: URLSessionConfiguration
    private let lock = NSLock()
    private var continuation: CheckedContinuation<NativeSatelliteProbeResponse, Error>?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var received = Data()
    private var response: HTTPURLResponse?
    private var finished = false

    init(url: URL, maximumBytes: Int, configuration: URLSessionConfiguration) {
        self.url = url; self.maximumBytes = maximumBytes; self.configuration = configuration
    }

    func value() async throws -> NativeSatelliteProbeResponse {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation(start)
        } onCancel: {
            self.finish(.failure(CancellationError()))
        }
    }

    private func start(_ continuation: CheckedContinuation<NativeSatelliteProbeResponse, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); continuation.resume(throwing: CancellationError()); return }
        self.continuation = continuation
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 4.5)
        request.httpMethod = "GET"
        request.setValue("image/jpeg", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        let task = session.dataTask(with: request)
        self.session = session; self.task = task
        lock.unlock()
        task.resume()
    }

    private func finish(_ result: Result<NativeSatelliteProbeResponse, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let continuation = continuation, session = session, task = task
        self.continuation = nil; self.session = nil; self.task = nil; response = nil
        received.removeAll(keepingCapacity: false)
        lock.unlock()
        task?.cancel(); session?.invalidateAndCancel(); continuation?.resume(with: result)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(Failure.redirect))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, response.url == url else {
            completionHandler(.cancel); finish(.failure(Failure.unexpectedResponse)); return
        }
        guard http.statusCode == 200 else {
            completionHandler(.cancel)
            finish(.failure((400...499).contains(http.statusCode) ? Failure.notAvailable : Failure.status))
            return
        }
        guard response.expectedContentLength < 0 || response.expectedContentLength <= maximumBytes else {
            completionHandler(.cancel); finish(.failure(Failure.sizeLimit)); return
        }
        lock.lock(); self.response = http; lock.unlock()
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        guard data.count <= maximumBytes - received.count else {
            lock.unlock(); finish(.failure(Failure.sizeLimit)); return
        }
        received.append(data); lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            finish(.failure((error as? URLError)?.code == .cancelled
                ? CancellationError() : Failure.transport))
            return
        }
        lock.lock(); let data = received; let http = response; lock.unlock()
        guard let http else { finish(.failure(Failure.unexpectedResponse)); return }
        finish(.success(.init(
            data: data,
            mimeType: http.value(forHTTPHeaderField: "Content-Type") ?? http.mimeType,
            requestedLayer: http.value(forHTTPHeaderField: "Layer-Identifier-Request"),
            actualLayer: http.value(forHTTPHeaderField: "Layer-Identifier-Actual"),
            requestedTime: http.value(forHTTPHeaderField: "Layer-Time-Request"),
            actualTime: http.value(forHTTPHeaderField: "Layer-Time-Actual")
        )))
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
