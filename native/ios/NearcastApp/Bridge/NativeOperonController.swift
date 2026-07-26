import Foundation
import OperonCoreDriver
import OperonFoundationModels
import OperonKit
import OperonSQLite

struct NativeOperonBridgeCommand: Sendable {
    let runID: String
    let kind: String
    let payloadJSON: String
}

struct NativeOperonProgressEvent: Sendable {
    let runID: String
    let eventJSON: String
}

typealias NativeOperonBridgeHandler = @MainActor @Sendable (NativeOperonBridgeCommand) async throws -> String
typealias NativeOperonProgressHandler = @MainActor @Sendable (NativeOperonProgressEvent) async -> Void

@available(iOS 26.0, *)
enum NativeOperonController {
    static func availability() async -> [String: Any] {
        let model = AppleFoundationModelsProvider()
        switch await model.availability() {
        case .available:
            return [
                "ok": true,
                "available": true,
                "model": "apple-system-language-model",
                "operon": true,
                "operonVersion": "0.4.0",
                "protocolVersion": "0.3"
            ]
        case .unavailable(let reason):
            return [
                "ok": true,
                "available": false,
                "reason": reason,
                "model": "apple-system-language-model",
                "operon": true,
                "operonVersion": "0.4.0",
                "protocolVersion": "0.3"
            ]
        }
    }

    static func runAgent(
        runID: String,
        options: [String: Any],
        bridge: @escaping NativeOperonBridgeHandler,
        progress: @escaping NativeOperonProgressHandler
    ) async -> [String: Any] {
        guard let query = options["query"] as? String, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return failure("invalid-request", "The native Operon request is missing a query.")
        }
        do {
            let descriptors = try skillDescriptors(from: options["skills"] as? [[String: Any]] ?? [])
            let sessionID = nonempty(options["sessionId"] as? String)
            let session = sessionID.map {
                NativeOperonSessionProvider(runID: runID, bridge: bridge, sessionID: $0)
            }
            let skillHost = NativeOperonSkillHost(runID: runID, bridge: bridge, descriptors: descriptors)
            let memoryScope = try decodeMemoryScope(options["memoryScope"])
            let memory = try memoryScope == nil
                ? nil
                : NativeOperonMemoryProvider(runID: runID, bridge: bridge)
            let completion = decodeCompletion(options["completion"])
            let maxReplans = min(3, max(0, number(options["maxReplans"])?.intValue ?? 1))
            let driver = OperonCoreDriver(
                model: AppleFoundationModelsProvider(),
                memory: memory,
                memoryScope: memoryScope,
                policy: OperonPolicy(
                    planning: .always,
                    maximumSources: 3,
                    maximumContextCharacters: 6_000,
                    maximumRepairAttempts: 1,
                    maximumReplans: maxReplans,
                    requireSkillOrClarification: true,
                    groundingMode: .citation,
                    validationFailure: .abstain,
                    requestTimeoutMilliseconds: 60_000
                ),
                sessionArtifacts: session,
                skillHost: skillHost,
                sessionID: sessionID,
                completion: completion
            )
            var terminalJSON: String?
            for try await event in driver.stream(String(query.prefix(1_800))) {
                try Task.checkCancellation()
                if case .finished(let completion) = event {
                    terminalJSON = completion.json
                    continue
                }
                if let eventJSON = try progressJSON(event) {
                    await progress(.init(runID: runID, eventJSON: eventJSON))
                }
            }
            guard let terminalJSON,
                  let result = try JSONSerialization.jsonObject(with: Data(terminalJSON.utf8)) as? [String: Any] else {
                return failure("invalid-result", "Operon returned an invalid terminal result.")
            }
            return [
                "ok": true,
                "available": true,
                "model": "apple-system-language-model",
                "operon": true,
                "operonVersion": "0.4.0",
                "protocolVersion": "0.3",
                "terminal": result
            ]
        } catch is CancellationError {
            return failure("cancelled", "The native Operon request was cancelled.")
        } catch {
            return failure("agent-failed", error.localizedDescription)
        }
    }

    private static func failure(_ reason: String, _ message: String) -> [String: Any] {
        [
            "ok": false,
            "available": true,
            "reason": reason,
            "message": message,
            "model": "apple-system-language-model",
            "operon": true,
            "operonVersion": "0.4.0",
            "protocolVersion": "0.3"
        ]
    }
}

@available(iOS 26.0, *)
private func progressJSON(_ event: OperonRunEvent) throws -> String? {
    switch event {
    case .stageStarted(let stage):
        let kind: String
        switch stage {
        case .ground: kind = "retrieve"
        case .validate: kind = "validate_output"
        case .skill: kind = "invoke_skill"
        default: kind = "generate"
        }
        return try jsonString([
            "kind": "command_started",
            "command": ["kind": kind, "stage": stage.rawValue],
            "native": true
        ])
    case .provisionalModelOutput(let stage, let text):
        // Provisional text has not passed Operon's validation. Expose only
        // progress metadata so it can never be mistaken for an answer.
        return try jsonString([
            "kind": "provisional",
            "stage": stage.rawValue,
            "characterCount": text.count,
            "native": true
        ])
    case .skillStarted(let id):
        return try jsonString(["kind": "skill_started", "skillId": id, "native": true])
    case .skillCompleted(let id):
        return try jsonString(["kind": "skill_completed", "skillId": id, "native": true])
    case .measurement(let sample):
        return try jsonString([
            "kind": "measurement",
            "sample": try jsonObject(sample),
            "native": true
        ])
    case .finished:
        return nil
    }
}

@available(iOS 26.0, *)
private final class NativeOperonSessionProvider: OperonSessionArtifactProvider, @unchecked Sendable {
    private let runID: String
    private let bridge: NativeOperonBridgeHandler
    private let sessionID: String

    init(runID: String, bridge: @escaping NativeOperonBridgeHandler, sessionID: String) {
        self.runID = runID
        self.bridge = bridge
        self.sessionID = sessionID
    }

    func load(sessionID: String, limit: Int) async throws -> [OperonSessionArtifact] {
        guard sessionID == self.sessionID else { return [] }
        let response = try await bridge(.init(
            runID: runID,
            kind: "load_session",
            payloadJSON: try jsonString(["sessionId": sessionID, "limit": limit])
        ))
        return try JSONDecoder().decode([OperonSessionArtifact].self, from: Data(response.utf8))
    }
}

@available(iOS 26.0, *)
private final class NativeOperonMemoryProvider: OperonMemoryStore, @unchecked Sendable {
    private let runID: String
    private let bridge: NativeOperonBridgeHandler
    private let store: SQLiteOperonMemoryStore

    init(runID: String, bridge: @escaping NativeOperonBridgeHandler) throws {
        self.runID = runID
        self.bridge = bridge
        let directory = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("Nearcast", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        store = try SQLiteOperonMemoryStore(url: directory.appendingPathComponent("operon-memory.sqlite"))
    }

    func search(_ query: String, scope: OperonMemoryScope, limit: Int) async throws -> [OperonMemoryRecord] {
        // Nearcast remains the memory authority. Refresh the private FTS index
        // from current application state before every lookup so deleted places
        // and plans cannot survive as stale model context.
        let response = try await bridge(.init(
            runID: runID,
            kind: "search_memory",
            payloadJSON: try jsonString([
                "query": "",
                "scope": try jsonObject(scope),
                "limit": 128
            ])
        ))
        let records = try JSONDecoder().decode([OperonMemoryRecord].self, from: Data(response.utf8))
        _ = try await store.delete(namespace: scope.namespace)
        for record in records where record.namespace == scope.namespace {
            _ = try await store.put(record)
        }
        return try await store.search(query, scope: scope, limit: limit)
    }
}

@available(iOS 26.0, *)
private final class NativeOperonSkillHost: OperonSkillHost, @unchecked Sendable {
    let descriptors: [OperonSkillDescriptor]
    private let runID: String
    private let bridge: NativeOperonBridgeHandler

    init(
        runID: String,
        bridge: @escaping NativeOperonBridgeHandler,
        descriptors: [OperonSkillDescriptor]
    ) {
        self.runID = runID
        self.bridge = bridge
        self.descriptors = descriptors
    }

    func prepare(_ request: OperonSkillPreparationRequest) async throws -> OperonSkillPreparation {
        let payload: [String: Any] = [
            "skillId": request.skillID,
            "partialArguments": try jsonObject(request.partialArguments),
            "artifacts": try request.artifacts.map(jsonObject)
        ]
        let response = try await bridge(.init(
            runID: runID,
            kind: "prepare_skill",
            payloadJSON: try jsonString(payload)
        ))
        guard let value = try JSONSerialization.jsonObject(with: Data(response.utf8)) as? [String: Any],
              let kind = value["kind"] as? String else {
            throw NativeOperonError.invalidBridgeResult("Skill preparation returned invalid JSON.")
        }
        switch kind {
        case "ready":
            return .ready(arguments: try operonValue(value["arguments"] ?? [:]))
        case "needs_input":
            let raw = value["clarification"] as? [String: Any] ?? value
            return .needsInput(OperonClarification(
                prompt: raw["prompt"] as? String ?? "Nearcast needs one more detail.",
                missingFields: raw["missing_fields"] as? [String] ?? [],
                skillID: raw["skill_id"] as? String ?? request.skillID
            ))
        case "rejected":
            return .rejected(reason: value["reason"] as? String ?? "Nearcast rejected this action.")
        default:
            return .unavailable(reason: value["reason"] as? String ?? "This Nearcast capability is unavailable.")
        }
    }

    func invoke(_ request: OperonSkillInvocationRequest) async throws -> OperonSkillResult {
        let payload: [String: Any] = [
            "skillId": request.skillID,
            "arguments": try jsonObject(request.arguments),
            "idempotencyKey": request.idempotencyKey,
            "requiresUserConfirmation": request.requiresUserConfirmation
        ]
        let response = try await bridge(.init(
            runID: runID,
            kind: "invoke_skill",
            payloadJSON: try jsonString(payload)
        ))
        return try JSONDecoder().decode(OperonSkillResult.self, from: Data(response.utf8))
    }
}

@available(iOS 26.0, *)
private func skillDescriptors(from values: [[String: Any]]) throws -> [OperonSkillDescriptor] {
    try values.map { value in
        guard let id = value["id"] as? String,
              let description = value["description"] as? String,
              let input = value["input_schema"] as? [String: Any],
              let output = value["output_schema"] as? [String: Any] else {
            throw NativeOperonError.invalidBridgeResult("A Nearcast skill descriptor is incomplete.")
        }
        return OperonSkillDescriptor(
            id: id,
            description: description,
            inputSchema: try operonSchema(input, name: "\(id)_input"),
            outputSchema: try operonSchema(output, name: "\(id)_output"),
            consumes: value["consumes"] as? [String] ?? [],
            produces: value["produces"] as? [String] ?? [],
            requiresUserConfirmation: value["requires_user_confirmation"] as? Bool ?? false
        )
    }
}

@available(iOS 26.0, *)
private func operonSchema(_ value: [String: Any], name: String) throws -> OperonSchema {
    if let reference = value["$ref"] as? String {
        return .reference(reference.components(separatedBy: "/").last ?? reference)
    }
    guard let type = value["type"] as? String else {
        throw NativeOperonError.invalidBridgeResult("Schema \(name) is missing its type.")
    }
    let description = value["description"] as? String
    let base: OperonSchema
    switch type {
    case "object":
        let rawProperties = value["properties"] as? [String: Any] ?? [:]
        let required = Set(value["required"] as? [String] ?? [])
        let properties = try rawProperties.keys.sorted().map { key -> OperonSchemaProperty in
            guard let child = rawProperties[key] as? [String: Any] else {
                throw NativeOperonError.invalidBridgeResult("Schema property \(key) is invalid.")
            }
            return OperonSchemaProperty(
                key,
                description: child["description"] as? String,
                schema: try operonSchema(child, name: "\(name)_\(key)"),
                isOptional: !required.contains(key)
            )
        }
        base = .object(name: schemaName(name), description: description, properties: properties)
    case "array":
        guard let items = value["items"] as? [String: Any] else {
            throw NativeOperonError.invalidBridgeResult("Schema \(name) is missing array items.")
        }
        base = .array(
            items: try operonSchema(items, name: "\(name)_item"),
            minimumItems: number(value["minItems"])?.intValue,
            maximumItems: number(value["maxItems"])?.intValue
        )
    case "string":
        base = .string(description: description, choices: value["enum"] as? [String])
    case "number":
        base = .number(
            description: description,
            minimum: number(value["minimum"])?.doubleValue,
            maximum: number(value["maximum"])?.doubleValue
        )
    case "integer":
        base = .integer(
            description: description,
            minimum: number(value["minimum"])?.intValue,
            maximum: number(value["maximum"])?.intValue
        )
    case "boolean":
        base = .boolean(description: description)
    default:
        throw NativeOperonError.invalidBridgeResult("Schema \(name) uses unsupported type \(type).")
    }
    guard let definitions = value["$defs"] as? [String: Any] else { return base }
    var parsed: [String: OperonSchema] = [:]
    for key in definitions.keys.sorted() {
        guard let definition = definitions[key] as? [String: Any] else { continue }
        parsed[key] = try operonSchema(definition, name: key)
    }
    return .definitions(root: base, values: parsed)
}

@available(iOS 26.0, *)
private func decodeMemoryScope(_ raw: Any?) throws -> OperonMemoryScope? {
    guard let raw, !(raw is NSNull) else { return nil }
    let data = try JSONSerialization.data(withJSONObject: raw)
    return try JSONDecoder().decode(OperonMemoryScope.self, from: data)
}

@available(iOS 26.0, *)
private func decodeCompletion(_ raw: Any?) -> OperonCompletionContract? {
    guard let value = raw as? [String: Any] else { return nil }
    let skills = value["required_skill_ids"] as? [String] ?? []
    let artifacts = value["required_artifact_kinds"] as? [String] ?? []
    return skills.isEmpty && artifacts.isEmpty ? nil : .init(
        requiredSkillIDs: skills,
        requiredArtifactKinds: artifacts
    )
}

private func number(_ value: Any?) -> NSNumber? {
    guard let value = value as? NSNumber, !(value is Bool) else { return nil }
    return value
}

private func nonempty(_ value: String?) -> String? {
    guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
        return nil
    }
    return value
}

private func schemaName(_ value: String) -> String {
    let cleaned = value.filter { $0.isLetter || $0.isNumber || $0 == "_" }
    return cleaned.isEmpty ? "NearcastSchema" : cleaned
}

private func jsonString(_ value: Any) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
}

private func jsonObject<Value: Encodable>(_ value: Value) throws -> Any {
    try JSONSerialization.jsonObject(with: JSONEncoder().encode(value), options: [.fragmentsAllowed])
}

private func operonValue(_ value: Any) throws -> OperonJSONValue {
    try JSONDecoder().decode(
        OperonJSONValue.self,
        from: JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
    )
}

private enum NativeOperonError: LocalizedError {
    case invalidBridgeResult(String)

    var errorDescription: String? {
        switch self {
        case .invalidBridgeResult(let message): return message
        }
    }
}
