import Foundation
import CryptoKit
import CoreFoundation
import Darwin

/// Local-only coordinator for a future delivery-transfer review surface.
///
/// This coordinator is intentionally narrower than P0's writer. It reads only
/// the active source scope's primary v3 receipt through a descriptor opened
/// read-only; it never creates a directory or lock, changes file protection,
/// reads a historical backup, or starts a compatibility/native delivery flow.
/// The caller supplies an immutable current Plan/Places mapping projection.
actor NativePlanDeliveryTransferReviewCoordinator {
    private let stageDirectory: URL
    private var sourceScope: NativeLegacySourceScope

    init(
        production: Bool,
        stageDirectory: URL = NativePlanNotificationIntentStore.defaultDirectory
    ) {
        self.init(
            sourceScope: NativeLegacySourceScope(production: production),
            stageDirectory: stageDirectory
        )
    }

    init(
        sourceScope: NativeLegacySourceScope,
        stageDirectory: URL = NativePlanNotificationIntentStore.defaultDirectory
    ) {
        self.sourceScope = sourceScope
        self.stageDirectory = stageDirectory
    }

    /// Changes only the coordinator's in-memory source selection. The next
    /// review reads that scope's exact primary receipt; there is no Local ↔
    /// Production fallback or shared staging path.
    func configure(production: Bool) {
        sourceScope = NativeLegacySourceScope(production: production)
    }

    func configure(sourceScope: NativeLegacySourceScope) {
        self.sourceScope = sourceScope
    }

    func currentSourceScope() -> NativeLegacySourceScope {
        sourceScope
    }

    /// Builds a local review draft only when the current source-scoped v3
    /// receipt and supplied immutable mappings still agree. It cannot save,
    /// revoke, restage, request permission, or claim delivery ownership.
    func review(
        mappings: NativePlanNotificationIntentMappingSnapshot
    ) -> NativePlanDeliveryTransferDraftReadiness {
        let activeScope = sourceScope
        guard mappings.sourceScope == activeScope else {
            return unavailable(.sourceScopeMismatch)
        }
        switch NativePlanDeliveryTransferReviewStageReader.read(
            baseDirectory: stageDirectory,
            sourceScope: activeScope
        ) {
        case .missing:
            return NativePlanDeliveryTransferDraftValidator.readiness(
                stage: nil,
                mappings: mappings,
                sourceScope: activeScope
            )
        case .stage(let stage):
            return NativePlanDeliveryTransferDraftValidator.readiness(
                stage: stage,
                mappings: mappings,
                sourceScope: activeScope
            )
        case .invalid:
            return unavailable(.staleStage)
        }
    }

    /// Rechecks a previously displayed draft against the same source-scoped
    /// primary receipt and the latest immutable mapping projection. This is
    /// still read-only; a changed value is unavailable rather than repaired.
    func revalidate(
        _ draft: NativePlanDeliveryTransferDraft,
        mappings: NativePlanNotificationIntentMappingSnapshot
    ) -> NativePlanDeliveryTransferDraftReadiness {
        let activeScope = sourceScope
        guard mappings.sourceScope == activeScope else {
            return unavailable(.sourceScopeMismatch)
        }
        switch NativePlanDeliveryTransferReviewStageReader.read(
            baseDirectory: stageDirectory,
            sourceScope: activeScope
        ) {
        case .missing:
            return NativePlanDeliveryTransferDraftValidator.validate(
                draft,
                stage: nil,
                mappings: mappings,
                sourceScope: activeScope
            )
        case .stage(let stage):
            return NativePlanDeliveryTransferDraftValidator.validate(
                draft,
                stage: stage,
                mappings: mappings,
                sourceScope: activeScope
            )
        case .invalid:
            return unavailable(.staleStage)
        }
    }

    private func unavailable(
        _ reason: NativePlanDeliveryTransferDraftUnavailabilityReason
    ) -> NativePlanDeliveryTransferDraftReadiness {
        .unavailable(.init(reasons: [reason]))
    }
}

/// Descriptor-only stage reader for the review boundary. It intentionally
/// reads no backup: a historical receipt is not current authority and using
/// one would make a local review silently diverge from P0's stage state.
private enum NativePlanDeliveryTransferReviewStageReader {
    private static let primaryName = "notification-intent-stage.v1.json"
    private static let maximumStoredBytes = 512 * 1_024
    private static let expectedKeys: Set<String> = [
        "schemaVersion", "minReaderVersion", "minWriterVersion", "owner", "stagingEpoch",
        "sourceScope", "sourceDigest", "sourceCapturedAt", "notificationIntent",
        "planMappings", "placeMappings", "defaultPlaceBinding", "mappingDigest",
        "isRevoked", "receiptDigest"
    ]

    enum Result {
        case missing
        case stage(NativePlanNotificationIntentStage)
        case invalid
    }

    static func read(
        baseDirectory: URL,
        sourceScope: NativeLegacySourceScope
    ) -> Result {
        let directory = sourceScope.scopedDirectory(from: baseDirectory)
        let url = directory.appendingPathComponent(primaryName, isDirectory: false)
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else {
            return errno == ENOENT || errno == ENOTDIR ? .missing : .invalid
        }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }

        var before = stat()
        guard fstat(descriptor, &before) == 0,
              before.st_mode & S_IFMT == S_IFREG,
              before.st_size >= 0,
              before.st_size <= off_t(maximumStoredBytes) else {
            return .invalid
        }
        let data: Data
        do {
            data = try handle.readToEnd() ?? Data()
        } catch {
            return .invalid
        }
        var after = stat()
        guard fstat(descriptor, &after) == 0,
              after.st_mode & S_IFMT == S_IFREG,
              before.st_dev == after.st_dev,
              before.st_ino == after.st_ino,
              before.st_size == after.st_size,
              data.count == Int(before.st_size),
              data.count <= maximumStoredBytes else {
            return .invalid
        }
        guard let stage = decodeCurrentStage(data) else { return .invalid }
        return .stage(stage)
    }

    private static func decodeCurrentStage(_ data: Data) -> NativePlanNotificationIntentStage? {
        guard !data.isEmpty,
              data.count <= maximumStoredBytes,
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(raw.keys) == expectedKeys,
              integer(raw["schemaVersion"]) == 3,
              integer(raw["minReaderVersion"]) == 3,
              integer(raw["minWriterVersion"]) == 3,
              raw["owner"] as? String == "legacy",
              let stage = try? JSONDecoder().decode(NativePlanNotificationIntentStage.self, from: data),
              hasCurrentShape(stage) else {
            return nil
        }
        var unsigned = stage
        unsigned.receiptDigest = ""
        guard digest(unsigned) == stage.receiptDigest else { return nil }
        return stage
    }

    private static func hasCurrentShape(_ stage: NativePlanNotificationIntentStage) -> Bool {
        guard stage.schemaVersion == 3,
              stage.minReaderVersion == 3,
              stage.minWriterVersion == 3,
              stage.owner == "legacy",
              stage.stagingEpoch > 0,
              validDigest(stage.sourceDigest),
              validDigest(stage.mappingDigest),
              validDigest(stage.receiptDigest),
              validCaptureDate(stage.sourceCapturedAt),
              stage.notificationIntent.hydration == "ready",
              stage.notificationIntent.selectedPlanIDs.count <= 3,
              stage.notificationIntent.selectedPlaceIDs.count <= 3,
              allDistinctAndValid(stage.notificationIntent.selectedPlanIDs),
              allDistinctAndValid(stage.notificationIntent.selectedPlaceIDs),
              stage.planMappings.count == stage.notificationIntent.selectedPlanIDs.count,
              stage.placeMappings.count == stage.notificationIntent.selectedPlaceIDs.count,
              stage.planMappings.map(\.legacyID) == stage.notificationIntent.selectedPlanIDs,
              stage.placeMappings.map(\.legacyID) == stage.notificationIntent.selectedPlaceIDs,
              allDistinctAndValid(stage.planMappings.map(\.legacyID)),
              allDistinctAndValid(stage.planMappings.map(\.nativePlanID)),
              stage.planMappings.allSatisfy({ validDigest($0.semanticDigest) }),
              allDistinctAndValid(stage.placeMappings.map(\.legacyID)),
              allDistinctAndValid(stage.placeMappings.map(\.nativePlaceID)) else {
            return false
        }

        switch stage.notificationIntent.placeSelectionMode {
        case .explicit:
            return stage.defaultPlaceBinding == nil
        case .default:
            guard stage.placeMappings.isEmpty,
                  let binding = stage.defaultPlaceBinding else { return false }
            return binding.nativePlacesRevision > 0 &&
                binding.nativePlaceIDs.count <= 3 &&
                allDistinctAndValid(binding.nativePlaceIDs)
        }
    }

    private static func digest<T: Encodable>(_ value: T) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value) else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue.rounded() == number.doubleValue,
              let integer = Int(number.stringValue) else { return nil }
        return integer
    }

    private static func validDigest(_ value: String) -> Bool {
        value.utf8.count == 64 && value.unicodeScalars.allSatisfy {
            (48...57).contains($0.value) || (97...102).contains($0.value)
        }
    }

    private static func validCaptureDate(_ value: String) -> Bool {
        guard validIdentifier(value), value.utf8.count <= 40 else { return false }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: value) else { return false }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        return formatter.string(from: date) == value
    }

    private static func allDistinctAndValid(_ values: [String]) -> Bool {
        Set(values).count == values.count && values.allSatisfy(validIdentifier)
    }

    private static func validIdentifier(_ value: String) -> Bool {
        value.utf16.count <= 160 &&
            !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !value.unicodeScalars.contains(where: { $0.value < 32 || (127...159).contains($0.value) })
    }
}
