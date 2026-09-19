import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

/// Direct, read-only public NOAA MRMS access. At most two concurrent decodes per
/// client; source discovery is bounded to two UTC days, three pages/day and 24
/// advertised frames. No persisted cache, cookies, credentials or location upload.
final class MRMSClient: @unchecked Sendable {
    private let transport: RadarChunkClient
    private let lock = NSLock()
    private var activeDecodes = 0

    init(configuration: URLSessionConfiguration = .ephemeral) throws {
        transport = try RadarChunkClient(allowedOrigins: [MRMSContract.origin], configuration: configuration)
    }

    func listRecentFrames(now: Date = Date(), historyMinutes: Int = 90, maximumFrames: Int = 10,
                          targetTimes: [Date] = [], toleranceMinutes: Int = 6) async throws -> [MRMSContract.AdvertisedFrame] {
        guard (1...180).contains(historyMinutes), (1...24).contains(maximumFrames),
              (1...15).contains(toleranceMinutes), targetTimes.count <= 24 else { throw MRMSContract.Failure.invalidOptions }
        let nowMS = try Self.milliseconds(now), earliest = nowMS - Int64(historyMinutes) * 60_000
        let targets = try targetTimes.map(Self.milliseconds).sorted()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        var day = calendar.startOfDay(for: Date(timeIntervalSince1970: Double(earliest) / 1000))
        let finalDay = calendar.startOfDay(for: now)
        var found: [String: MRMSContract.AdvertisedFrame] = [:], dayCount = 0
        while day <= finalDay {
            try Task.checkCancellation()
            dayCount += 1
            guard dayCount <= 2 else { throw MRMSContract.Failure.invalidOptions }
            let parts = calendar.dateComponents([.year, .month, .day], from: day)
            let date = String(format: "%04d%02d%02d", parts.year!, parts.month!, parts.day!)
            let prefix = "CONUS/\(MRMSContract.product)/\(date)/"
            var token: String?, seenTokens = Set<String>()
            for pageIndex in 0..<3 {
                let url = try Self.listingURL(prefix: prefix, continuationToken: token)
                let data = try await transport.fetchBytes(at: url, maximumBytes: 2 * 1024 * 1024)
                let page = try Self.parseListing(data, expectedPrefix: prefix)
                for frame in page.frames where frame.validTimeMilliseconds >= earliest && frame.validTimeMilliseconds <= nowMS {
                    if let old = found[frame.key], old != frame { throw MRMSContract.Failure.invalidListing }
                    found[frame.key] = frame
                }
                guard page.isTruncated else { break }
                guard pageIndex < 2, let next = page.continuationToken, seenTokens.insert(next).inserted else {
                    throw MRMSContract.Failure.listingLimit
                }
                token = next
            }
            guard let nextDay = calendar.date(byAdding: .day, value: 1, to: day) else { throw MRMSContract.Failure.invalidTime }
            day = nextDay
        }
        return Self.selectFrames(Array(found.values), targets: targets, maximumFrames: maximumFrames,
                                 toleranceMilliseconds: Int64(toleranceMinutes) * 60_000)
    }

    func decodeFrame(_ frame: MRMSContract.AdvertisedFrame, bounds: RadarChunkContract.Bounds,
                     width: Int = 512, height: Int = 384,
                     encoding: RadarNumericContract.Encoding = try! .init()) async throws -> MRMSContract.Viewport {
        guard admitDecode() else { throw MRMSContract.Failure.requestLimit }
        defer { releaseDecode() }
        try Task.checkCancellation()
        // Validate caller-controlled allocation geometry before downloading.
        try bounds.validate()
        guard (64...1024).contains(width), (64...1024).contains(height),
              width <= RadarNumericContract.maximumTexturePixels / height else { throw MRMSContract.Failure.invalidOptions }
        let data = try await transport.fetchBytes(at: frame.url, maximumBytes: frame.byteLength)
        try Task.checkCancellation()
        let job = Task.detached(priority: .userInitiated) {
            try MRMSContract.decode(data, frame: frame, bounds: bounds, width: width, height: height, encoding: encoding)
        }
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await job.value
        }, onCancel: { job.cancel() })
    }

    private func admitDecode() -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard activeDecodes < 2 else { return false }
        activeDecodes += 1; return true
    }
    private func releaseDecode() { lock.lock(); activeDecodes -= 1; lock.unlock() }

    private static func milliseconds(_ date: Date) throws -> Int64 {
        let seconds = date.timeIntervalSince1970
        guard seconds.isFinite, seconds >= 0, seconds < 253_402_300_800 else { throw MRMSContract.Failure.invalidTime }
        return Int64(floor(seconds * 1000))
    }

    static func listingURL(prefix: String, continuationToken: String?) throws -> URL {
        guard prefix.range(of: #"^CONUS/MergedReflectivityQCComposite_00\.50/[0-9]{8}/$"#,
                           options: .regularExpression) != nil,
              continuationToken.map({ !$0.isEmpty && $0.utf8.count <= 4096 && !$0.contains(where: { $0.isNewline }) }) ?? true else {
            throw MRMSContract.Failure.invalidListing
        }
        var components = URLComponents(url: MRMSContract.origin, resolvingAgainstBaseURL: false)!
        components.path = "/"
        components.queryItems = [URLQueryItem(name: "list-type", value: "2"), URLQueryItem(name: "max-keys", value: "1000"),
                                 URLQueryItem(name: "prefix", value: prefix)]
        if let continuationToken { components.queryItems!.append(.init(name: "continuation-token", value: continuationToken)) }
        guard let url = components.url else { throw MRMSContract.Failure.invalidListing }
        return url
    }

    struct ListingPage {
        let frames: [MRMSContract.AdvertisedFrame]
        let isTruncated: Bool
        let continuationToken: String?
    }

    static func parseListing(_ data: Data, expectedPrefix: String) throws -> ListingPage {
        try Task.checkCancellation()
        guard data.count <= 2 * 1024 * 1024, let xml = String(data: data, encoding: .utf8),
              !xml.localizedCaseInsensitiveContains("<!DOCTYPE"), !xml.localizedCaseInsensitiveContains("<!ENTITY") else {
            throw MRMSContract.Failure.invalidListing
        }
        let delegate = MRMSListingParser()
        let parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.delegate = delegate
        let parsed = parser.parse()
        try Task.checkCancellation()
        guard parsed, !delegate.failed, delegate.stack.isEmpty,
              delegate.fields["Name"] == "noaa-mrms-pds", delegate.fields["Prefix"] == expectedPrefix,
              let countText = delegate.fields["KeyCount"], let count = Int(countText), count == delegate.entries.count,
              count <= 1000, let truncated = delegate.fields["IsTruncated"], ["true", "false"].contains(truncated) else {
            throw MRMSContract.Failure.invalidListing
        }
        let token = delegate.fields["NextContinuationToken"]
        guard truncated != "true" || (token.map { !$0.isEmpty && $0.utf8.count <= 4096 } ?? false) else {
            throw MRMSContract.Failure.invalidListing
        }
        var frames: [MRMSContract.AdvertisedFrame] = [], keys = Set<String>()
        for entry in delegate.entries {
            guard let key = entry["Key"], key.hasPrefix(expectedPrefix), keys.insert(key).inserted,
                  let sizeText = entry["Size"], let size = Int(sizeText), size > 0 else { throw MRMSContract.Failure.invalidListing }
            guard size <= MRMSContract.maximumDownloadBytes else { continue }
            frames.append(try MRMSContract.AdvertisedFrame(key: key, byteLength: size))
        }
        return ListingPage(frames: frames, isTruncated: truncated == "true", continuationToken: token)
    }

    /// Matches the browser adapter's earliest tie, always-retain-newest and even
    /// subsampling rules. Input is already filtered to non-future observations.
    static func selectFrames(_ frames: [MRMSContract.AdvertisedFrame], targets: [Int64], maximumFrames: Int,
                             toleranceMilliseconds: Int64) -> [MRMSContract.AdvertisedFrame] {
        guard maximumFrames > 0 else { return [] }
        let sorted = frames.sorted { $0.validTimeMilliseconds < $1.validTimeMilliseconds }
        var selected = sorted
        if !targets.isEmpty {
            var byKey: [String: MRMSContract.AdvertisedFrame] = [:]
            for target in targets {
                var nearest: MRMSContract.AdvertisedFrame?, delta = Int64.max
                for frame in sorted {
                    let subtraction = frame.validTimeMilliseconds >= target
                        ? frame.validTimeMilliseconds.subtractingReportingOverflow(target)
                        : target.subtractingReportingOverflow(frame.validTimeMilliseconds)
                    guard !subtraction.overflow else { continue }
                    let difference = subtraction.partialValue
                    if difference < delta { nearest = frame; delta = difference }
                }
                if let nearest, delta <= toleranceMilliseconds { byKey[nearest.key] = nearest }
            }
            if let newest = sorted.last { byKey[newest.key] = newest }
            selected = byKey.values.sorted { $0.validTimeMilliseconds < $1.validTimeMilliseconds }
        }
        guard selected.count > maximumFrames else { return selected }
        if maximumFrames == 1 { return [selected.last!] }
        return (0..<maximumFrames).map { index in
            selected[Int(floor(Double(index) * Double(selected.count - 1) / Double(maximumFrames - 1) + 0.5))]
        }
    }
}

private final class MRMSListingParser: NSObject, XMLParserDelegate {
    var stack: [String] = [], fields: [String: String] = [:], entries: [[String: String]] = []
    var failed = false
    private var current: [String: String]?, text = "", elementCount = 0
    private let rootFields: Set<String> = ["Name", "Prefix", "KeyCount", "IsTruncated", "NextContinuationToken"]
    private let objectFields: Set<String> = ["Key", "Size"]
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?,
                attributes attributeDict: [String: String]) {
        elementCount += 1
        guard stack.count < 8, elementCount <= 20_000,
              !stack.isEmpty || elementName == "ListBucketResult" else { fail(parser); return }
        if elementName == "Contents" {
            guard stack == ["ListBucketResult"], current == nil, entries.count < 1000 else { fail(parser); return }
            current = [:]
        }
        stack.append(elementName); text = ""
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard text.utf8.count + string.utf8.count <= 8192 else { fail(parser); return }
        text += string
    }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        guard stack.last == elementName else { fail(parser); return }
        if stack.count == 2, rootFields.contains(elementName) {
            guard fields[elementName] == nil else { fail(parser); return }
            fields[elementName] = text
        } else if stack.count == 3, stack[1] == "Contents", objectFields.contains(elementName) {
            guard current?[elementName] == nil else { fail(parser); return }
            current?[elementName] = text
        } else if elementName == "Contents" {
            guard let current else { fail(parser); return }
            entries.append(current); self.current = nil
        }
        stack.removeLast(); text = ""
    }
    func parser(_ parser: XMLParser, parseErrorOccurred parseError: Error) { failed = true }
    func parser(_ parser: XMLParser, resolveExternalEntityName name: String, systemID: String?) -> Data? {
        fail(parser); return nil
    }
    private func fail(_ parser: XMLParser) { failed = true; parser.abortParsing() }
}
