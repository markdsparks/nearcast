import Foundation

#if canImport(FoundationModels)
import FoundationModels
import OperonKit
import OperonFoundationModels

@available(iOS 26.0, *)
enum NativeLanguageModelController {
    static var capabilities: [String: Any] {
        var result: [String: Any] = [
            "execution": "on-device",
            "systemVersion": ProcessInfo.processInfo.operatingSystemVersionString,
            "contextTokens": SystemLanguageModel.default.contextSize,
            "tokenCounting": false
        ]
        if #available(iOS 26.4, *) { result["tokenCounting"] = true }
        return result
    }

    // Operon's character budget controls evidence selection, not model capacity.
    // The exact serialized request is checked separately immediately before inference.
    static var evidenceCharacterBudget: Int {
        min(12_000, max(2_000, SystemLanguageModel.default.contextSize))
    }

    static func availability() -> [String: Any] {
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
            return [
                "ok": true,
                "available": true,
                "reason": "available",
                "model": "apple-system-language-model",
                "capabilities": capabilities
            ]
        case .unavailable(let reason):
            return [
                "ok": true,
                "available": false,
                "reason": availabilityReason(reason),
                "model": "apple-system-language-model",
                "capabilities": capabilities
            ]
        }
    }

    static func generate(options: [String: Any]) async -> [String: Any] {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            var result = availability()
            result["ok"] = false
            result["message"] = unavailableMessage(result["reason"] as? String ?? "")
            return result
        }

        guard let rawMessages = options["messages"] as? [[String: Any]],
              let rawSchema = options["schema"] as? [String: Any] else {
            return failure("invalid-request", "The native model request is missing messages or a schema.")
        }

        do {
            let messages = rawMessages.compactMap { value -> (role: String, content: String)? in
                guard let role = value["role"] as? String,
                      let content = value["content"] as? String else { return nil }
                return (role, content)
            }
            guard messages.count == rawMessages.count else {
                return failure("invalid-messages", "The native model request contains an invalid message.")
            }

            let instructions = messages
                .filter { $0.role == "system" }
                .map(\.content)
                .joined(separator: "\n\n")
            let prompt = messages
                .filter { $0.role != "system" }
                .map { "\($0.role.uppercased()):\n\($0.content)" }
                .joined(separator: "\n\n")
            let schema = try generationSchema(from: rawSchema)
            let temperature = options["temperature"] as? Double ?? 0.1
            let maximumTokens = options["maximumResponseTokens"] as? Int
            let response = try await respond(instructions: instructions, prompt: prompt,
                schema: schema, temperature: temperature, maximumTokens: maximumTokens)
            return [
                "ok": true,
                "available": true,
                "model": "apple-system-language-model",
                "text": response.text,
                "finishReason": "stop"
            ]
        } catch {
            let issue = modelIssue(error)
            return failure(issue.reason, issue.message)
        }
    }

    static func respond(instructions: String, prompt: String, schema: GenerationSchema,
                        temperature: Double, maximumTokens: Int?) async throws -> OperonGenerationResponse {
        let model = SystemLanguageModel.default
        try Task.checkCancellation()
        if case .unavailable(let reason) = model.availability {
            let code = availabilityReason(reason)
            throw NearcastModelIssue(reason: code, message: unavailableMessage(code))
        }
        let outputBudget = min(max(128, maximumTokens ?? 768), max(128, model.contextSize / 3))
        var inputTokens: Int?
        if #available(iOS 26.4, *) {
            let instructionTokens = try await model.tokenCount(for: Instructions(instructions))
            let promptTokens = try await model.tokenCount(for: prompt)
            let schemaTokens = try await model.tokenCount(for: schema)
            let count = instructionTokens + promptTokens + schemaTokens
            // Reserve framing overhead as well as output. Never truncate a place,
            // state, date, or requested action to squeeze a command into context.
            guard count + outputBudget + 256 <= model.contextSize else {
                throw NearcastModelIssue(reason: "context-limit", message: "This request has more detail than on-device AI can handle at once. Try one question at a time or start a new chat.")
            }
            inputTokens = count
        }
        let session = LanguageModelSession(model: model, tools: [], instructions: instructions)
        do {
            let response = try await session.respond(to: prompt, schema: schema,
                includeSchemaInPrompt: true,
                options: GenerationOptions(temperature: temperature, maximumResponseTokens: outputBudget))
            return OperonGenerationResponse(text: response.content.jsonString, promptTokens: inputTokens)
        } catch {
            throw modelIssue(error)
        }
    }

    static func unavailableMessage(_ reason: String) -> String {
        switch reason.replacingOccurrences(of: "_", with: "-") {
        case "model-not-ready": return "Apple’s on-device AI is still getting ready. You can keep using the forecast and try Ask again later."
        case "apple-intelligence-not-enabled": return "Enable Apple Intelligence in Settings to use on-device AI. The forecast is still available."
        case "device-not-eligible": return "This device doesn’t support Apple’s on-device AI. You can still use the forecast, hourly view, and map."
        default: return "On-device AI is unavailable right now. The forecast is still available."
        }
    }

    static func modelIssue(_ error: Error) -> NearcastModelIssue {
        if let issue = error as? NearcastModelIssue { return issue }
        if error is CancellationError { return .init(reason: "cancelled", message: "Request cancelled.") }
        if let error = error as? LanguageModelSession.GenerationError {
            switch error {
            case .exceededContextWindowSize:
                return .init(reason: "context-limit", message: "This conversation is too long for on-device AI. Start a new chat or ask one question at a time.")
            case .assetsUnavailable:
                return .init(reason: "model-not-ready", message: unavailableMessage("model-not-ready"))
            case .unsupportedLanguageOrLocale:
                return .init(reason: "unsupported-language", message: "On-device AI doesn’t support this request’s language yet. The forecast is still available.")
            case .rateLimited, .concurrentRequests:
                return .init(reason: "model-busy", message: "On-device AI is busy. Please try again in a moment.")
            case .guardrailViolation, .refusal:
                return .init(reason: "model-refusal", message: "On-device AI couldn’t answer that request. Try asking a specific weather question.")
            default: break
            }
        }
        return .init(reason: "generation-failed", message: "On-device AI couldn’t finish this request. Please try again. The forecast is still available.")
    }

    private static func failure(_ reason: String, _ message: String) -> [String: Any] {
        [
            "ok": false,
            "available": true,
            "reason": reason,
            "message": message,
            "model": "apple-system-language-model"
        ]
    }

}

struct NearcastModelIssue: LocalizedError {
    let reason: String
    let message: String
    var errorDescription: String? { message }
}

actor NearcastModelIssueStore {
    private var issue: NearcastModelIssue?
    func set(_ value: NearcastModelIssue?) { issue = value }
    func current() -> NearcastModelIssue? { issue }
}

// Keep Operon responsible for tools, validation, and completion. This adapter
// changes only inference budgeting and error reporting, never weather authority.
@available(iOS 26.0, *)
struct NearcastFoundationModelsProvider: OperonModelProvider {
    let issues: NearcastModelIssueStore
    func availability() async -> OperonAvailability {
        await AppleFoundationModelsProvider().availability()
    }

    func generate(_ request: OperonGenerationRequest) async throws -> OperonGenerationResponse {
        let instructions = request.messages.filter { $0.role == .system }.map(\.content).joined(separator: "\n\n")
        let prompt = request.messages.filter { $0.role != .system }
            .map { "\($0.role.rawValue.uppercased()):\n\($0.content)" }.joined(separator: "\n\n")
        do {
            let response = try await NativeLanguageModelController.respond(instructions: instructions, prompt: prompt,
                schema: operonGenerationSchema(request.schema), temperature: request.temperature,
                maximumTokens: request.maximumResponseTokens)
            await issues.set(nil)
            return response
        } catch {
            let issue = NativeLanguageModelController.modelIssue(error)
            await issues.set(issue)
            throw issue
        }
    }
}

@available(iOS 26.0, *)
private func operonGenerationSchema(_ schema: OperonSchema) throws -> GenerationSchema {
    if case .definitions(let root, let values) = schema {
        return try GenerationSchema(root: operonDynamicSchema(root, name: "Root"),
            dependencies: values.keys.sorted().map { operonDynamicSchema(values[$0]!, name: $0) })
    }
    return try GenerationSchema(root: operonDynamicSchema(schema, name: "Root"), dependencies: [])
}

@available(iOS 26.0, *)
private func operonDynamicSchema(_ schema: OperonSchema, name: String) -> DynamicGenerationSchema {
    switch schema {
    case .object(let title, let description, let properties):
        return DynamicGenerationSchema(name: title, description: description, properties: properties.map {
            .init(name: $0.name, description: $0.description,
                  schema: operonDynamicSchema($0.schema, name: name + "_" + $0.name), isOptional: $0.isOptional)
        })
    case .array(let items, let minimum, let maximum):
        return DynamicGenerationSchema(arrayOf: operonDynamicSchema(items, name: name + "_Item"), minimumElements: minimum, maximumElements: maximum)
    case .string(_, let choices):
        if let choices { return DynamicGenerationSchema(name: sanitizedSchemaName(name) + "Choice", anyOf: choices) }
        return DynamicGenerationSchema(type: String.self)
    case .number(_, let minimum, let maximum):
        var guides: [GenerationGuide<Double>] = []
        if let minimum { guides.append(.minimum(minimum)) }
        if let maximum { guides.append(.maximum(maximum)) }
        return DynamicGenerationSchema(type: Double.self, guides: guides)
    case .integer(_, let minimum, let maximum):
        var guides: [GenerationGuide<Int>] = []
        if let minimum { guides.append(.minimum(minimum)) }
        if let maximum { guides.append(.maximum(maximum)) }
        return DynamicGenerationSchema(type: Int.self, guides: guides)
    case .boolean: return DynamicGenerationSchema(type: Bool.self)
    case .reference(let reference): return DynamicGenerationSchema(referenceTo: reference)
    case .definitions(let root, _): return operonDynamicSchema(root, name: name)
    }
}

@available(iOS 26.0, *)
private func generationSchema(from value: [String: Any]) throws -> GenerationSchema {
    let definitions = value["$defs"] as? [String: Any] ?? [:]
    return try GenerationSchema(
        root: dynamicSchema(from: value, path: "NearcastRoot"),
        dependencies: definitions.keys.sorted().map { name in
            guard let definition = definitions[name] as? [String: Any] else {
                throw NativeLanguageModelSchemaError.invalidDefinition(name)
            }
            return try dynamicSchema(from: definition, path: name)
        }
    )
}

@available(iOS 26.0, *)
private func dynamicSchema(from value: [String: Any], path: String) throws -> DynamicGenerationSchema {
    if let reference = value["$ref"] as? String {
        return DynamicGenerationSchema(
            referenceTo: reference.components(separatedBy: "/").last ?? reference
        )
    }
    guard let type = value["type"] as? String else {
        throw NativeLanguageModelSchemaError.missingType(path)
    }
    let description = value["description"] as? String
    switch type {
    case "object":
        guard let rawProperties = value["properties"] as? [String: Any] else {
            throw NativeLanguageModelSchemaError.invalidProperties(path)
        }
        let required = Set(value["required"] as? [String] ?? [])
        let properties = try rawProperties.keys.sorted().map { name -> DynamicGenerationSchema.Property in
            guard let child = rawProperties[name] as? [String: Any] else {
                throw NativeLanguageModelSchemaError.invalidProperty("\(path).\(name)")
            }
            return DynamicGenerationSchema.Property(
                name: name,
                description: child["description"] as? String,
                schema: try dynamicSchema(from: child, path: "\(path)_\(name)"),
                isOptional: !required.contains(name)
            )
        }
        return DynamicGenerationSchema(
            name: sanitizedSchemaName(path),
            description: description,
            properties: properties
        )
    case "array":
        guard let items = value["items"] as? [String: Any] else {
            throw NativeLanguageModelSchemaError.invalidItems(path)
        }
        return DynamicGenerationSchema(
            arrayOf: try dynamicSchema(from: items, path: "\(path)_Item"),
            minimumElements: (value["minItems"] as? NSNumber)?.intValue,
            maximumElements: (value["maxItems"] as? NSNumber)?.intValue
        )
    case "string":
        if let choices = value["enum"] as? [String], !choices.isEmpty {
            return DynamicGenerationSchema(name: sanitizedSchemaName(path) + "Choice", anyOf: choices)
        }
        return DynamicGenerationSchema(type: String.self)
    case "number":
        var guides: [GenerationGuide<Double>] = []
        if let minimum = (value["minimum"] as? NSNumber)?.doubleValue { guides.append(.minimum(minimum)) }
        if let maximum = (value["maximum"] as? NSNumber)?.doubleValue { guides.append(.maximum(maximum)) }
        return DynamicGenerationSchema(type: Double.self, guides: guides)
    case "integer":
        var guides: [GenerationGuide<Int>] = []
        if let minimum = (value["minimum"] as? NSNumber)?.intValue { guides.append(.minimum(minimum)) }
        if let maximum = (value["maximum"] as? NSNumber)?.intValue { guides.append(.maximum(maximum)) }
        return DynamicGenerationSchema(type: Int.self, guides: guides)
    case "boolean":
        return DynamicGenerationSchema(type: Bool.self)
    default:
        throw NativeLanguageModelSchemaError.unsupportedType(path, type)
    }
}

private enum NativeLanguageModelSchemaError: LocalizedError {
    case missingType(String)
    case invalidProperties(String)
    case invalidProperty(String)
    case invalidItems(String)
    case invalidDefinition(String)
    case unsupportedType(String, String)

    var errorDescription: String? {
        switch self {
        case .missingType(let path): return "Schema \(path) is missing a type."
        case .invalidProperties(let path): return "Schema \(path) has invalid properties."
        case .invalidProperty(let path): return "Schema property \(path) is invalid."
        case .invalidItems(let path): return "Schema array \(path) has invalid items."
        case .invalidDefinition(let name): return "Schema definition \(name) is invalid."
        case .unsupportedType(let path, let type): return "Schema \(path) uses unsupported type \(type)."
        }
    }
}

private func sanitizedSchemaName(_ value: String) -> String {
    let cleaned = value.filter { $0.isLetter || $0.isNumber || $0 == "_" }
    return cleaned.isEmpty ? "NearcastSchema" : cleaned
}

@available(iOS 26.0, *)
private func availabilityReason(
    _ reason: SystemLanguageModel.Availability.UnavailableReason
) -> String {
    switch reason {
    case .deviceNotEligible:
        return "device-not-eligible"
    case .appleIntelligenceNotEnabled:
        return "apple-intelligence-not-enabled"
    case .modelNotReady:
        return "model-not-ready"
    @unknown default:
        return "unknown"
    }
}
#endif
