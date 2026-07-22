import Foundation

#if canImport(FoundationModels)
import FoundationModels

@available(iOS 26.0, *)
enum NativeLanguageModelController {
    static func availability() -> [String: Any] {
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
            return [
                "ok": true,
                "available": true,
                "reason": "available",
                "model": "apple-system-language-model"
            ]
        case .unavailable(let reason):
            return [
                "ok": true,
                "available": false,
                "reason": availabilityReason(reason),
                "model": "apple-system-language-model"
            ]
        }
    }

    static func generate(options: [String: Any]) async -> [String: Any] {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            var result = availability()
            result["ok"] = false
            result["message"] = "Apple's on-device language model is unavailable."
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
            let session = LanguageModelSession(model: model, tools: [], instructions: instructions)
            let response = try await session.respond(
                to: prompt,
                schema: schema,
                includeSchemaInPrompt: true,
                options: GenerationOptions(
                    temperature: temperature,
                    maximumResponseTokens: maximumTokens
                )
            )
            return [
                "ok": true,
                "available": true,
                "model": "apple-system-language-model",
                "text": response.content.jsonString,
                "finishReason": "stop"
            ]
        } catch {
            return failure("generation-failed", nativeErrorMessage(error))
        }
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

    private static func nativeErrorMessage(_ error: Error) -> String {
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return message.isEmpty ? "Apple's on-device language model could not complete the request." : message
    }
}

@available(iOS 26.0, *)
private func generationSchema(from value: [String: Any]) throws -> GenerationSchema {
    try GenerationSchema(root: dynamicSchema(from: value, path: "NearcastRoot"), dependencies: [])
}

@available(iOS 26.0, *)
private func dynamicSchema(from value: [String: Any], path: String) throws -> DynamicGenerationSchema {
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
        return DynamicGenerationSchema(arrayOf: try dynamicSchema(from: items, path: "\(path)_Item"))
    case "string":
        if let choices = value["enum"] as? [String], !choices.isEmpty {
            return DynamicGenerationSchema(name: sanitizedSchemaName(path) + "Choice", anyOf: choices)
        }
        return DynamicGenerationSchema(type: String.self)
    case "number":
        return DynamicGenerationSchema(type: Double.self)
    case "integer":
        return DynamicGenerationSchema(type: Int.self)
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
    case unsupportedType(String, String)

    var errorDescription: String? {
        switch self {
        case .missingType(let path): return "Schema \(path) is missing a type."
        case .invalidProperties(let path): return "Schema \(path) has invalid properties."
        case .invalidProperty(let path): return "Schema property \(path) is invalid."
        case .invalidItems(let path): return "Schema array \(path) has invalid items."
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
