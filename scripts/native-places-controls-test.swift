import Foundation

private enum TestFailure: Error, CustomStringConvertible {
    case failed(String)
    var description: String { switch self { case .failed(let text): return text } }
}

private func expect(_ condition: Bool, _ message: String) throws {
    if !condition { throw TestFailure.failed(message) }
}

private func place(_ id: String = "4243918", name: String = "Maryville", numeric: Bool = true) -> NativeManagedPlace {
    NativeManagedPlace(id: id, legacyIDType: numeric ? "number" : nil, name: name, admin1: "Illinois", country: "United States",
        countryCode: "US", latitude: 38.7237, longitude: -89.9559, alias: "Home", timezone: "America/Chicago", followsCurrentLocation: false)
}

private func fixture() -> NativePlacesSource {
    NativePlacesSource(capturedAt: "2026-09-18T19:00:00.000Z", selectedPlace: place(), lastPlace: place(),
        savedPlaces: [place(), place("spare", name: "Nokomis", numeric: false)],
        preferences: NativePlacesPreferences(unit: "fahrenheit", timeFormat: "auto", theme: "auto", reactiveSkyEnabled: false, reactiveSkyMotionAllowed: true))
}

@MainActor
private final class Writer {
    var source = fixture()
    var commands: [NativePlacesCommand] = []
    var replyOverride: ((NativePlacesCommand) throws -> NativePlacesReply)?
    var heldActions = Set<String>()
    var pending: [String: CheckedContinuation<NativePlacesReply, Error>] = [:]
    private var sequence = 0

    func call(_ command: NativePlacesCommand) async throws -> NativePlacesReply {
        commands.append(command)
        if heldActions.contains(command.action) {
            return try await withCheckedThrowingContinuation { pending[command.requestID] = $0 }
        }
        if let replyOverride { return try replyOverride(command) }
        return normalReply(command)
    }

    func normalReply(_ command: NativePlacesCommand) -> NativePlacesReply {
        if command.action == "search" { return NativePlacesReply(requestID: command.requestID, ok: true, results: [place()]) }
        sequence += 1
        source.capturedAt = String(format: "2026-09-18T19:%02d:%02d.000Z", sequence / 60, sequence % 60)
        switch command.action {
        case "select": source.selectedPlace = command.place; source.lastPlace = command.place
        case "save": if let value = command.place, !source.savedPlaces.contains(where: { $0.id == value.id }) { source.savedPlaces.append(value) }
        case "rename":
            if let index = source.savedPlaces.firstIndex(where: { $0.id == command.id }) { source.savedPlaces[index].alias = command.alias }
        case "move":
            if let index = source.savedPlaces.firstIndex(where: { $0.id == command.id }), let direction = command.direction { source.savedPlaces.swapAt(index, index + direction) }
        case "remove": source.savedPlaces.removeAll { $0.id == command.id }
        case "preferences":
            if let value = command.preferences?.unit { source.preferences.unit = value }
            if let value = command.preferences?.timeFormat { source.preferences.timeFormat = value }
            if let value = command.preferences?.theme { source.preferences.theme = value }
            if let value = command.preferences?.reactiveSkyEnabled { source.preferences.reactiveSkyEnabled = value }
            if let value = command.preferences?.reactiveSkyMotionAllowed { source.preferences.reactiveSkyMotionAllowed = value }
        case "currentLocation":
            var current = place("gps-current", numeric: false)
            current.followsCurrentLocation = true
            source.selectedPlace = current
            source.lastPlace = current
        default: break
        }
        return NativePlacesReply(requestID: command.requestID, ok: true, source: source)
    }

    func resolve(_ command: NativePlacesCommand, reply: NativePlacesReply? = nil) {
        pending.removeValue(forKey: command.requestID)?.resume(returning: reply ?? normalReply(command))
    }

    func waitForCommands(_ count: Int) async throws {
        for _ in 0..<10_000 {
            if commands.count >= count { return }
            await Task.yield()
        }
        throw TestFailure.failed("A controlled transport call was not reached")
    }
}

@main
private struct NativePlacesControlsTests {
    @MainActor
    static func main() async throws {
        try validationAndCoding()
        try await editsAndPreferences()
        try await unsupportedPreviewLabels()
        try await failureAndFreshness()
        try await raceAndCancellation()
        try await nativeOwnerAdoption()
        print("Native places controls tests passed")
    }

    static func validationAndCoding() throws {
        let value = fixture()
        try expect(value.isValid, "Baseline must be valid")
        try expect(value.selectedPlace?.displayName == "Home", "Alias must be used for display")
        try expect(value.selectedPlace?.subtitle == "Maryville, Illinois, United States", "Search subtitle identifies the exact city")
        try expect(value.toPreviewContext()?.selectedPlace.id == "4243918", "Native context preserves identifiers")
        try expect(value.toPreviewContext()?.selectedPlace.name == "Maryville, Illinois", "Native handoff uses canonical place label instead of alias")
        var foreign = place("leverkusen", name: "Leverkusen", numeric: false)
        foreign.admin1 = "North Rhine-Westphalia"; foreign.country = "Germany"; foreign.countryCode = "DE"; foreign.alias = "Friends"
        try expect(foreign.previewPlace.name == "Leverkusen, North Rhine-Westphalia, Germany", "Foreign place handoff includes country and ignores alias")
        foreign.name = "Leverkusen, North Rhine-Westphalia, Germany, Germany"
        try expect(foreign.previewPlace.name == "Leverkusen, North Rhine-Westphalia, Germany", "Legacy qualified names are canonicalized before handoff")
        var duplicateQualifier = place()
        duplicateQualifier.name = "Québec"; duplicateQualifier.admin1 = "Quebec"; duplicateQualifier.country = "Canada"; duplicateQualifier.countryCode = "CA"
        try expect(duplicateQualifier.previewPlace.name == "Québec, Canada", "Label deduplication matches accent-insensitive legacy qualifiers")
        var nonLatin = value
        nonLatin.selectedPlace?.name = "東京"
        nonLatin.selectedPlace?.admin1 = "東京都"
        nonLatin.selectedPlace?.country = "日本"
        nonLatin.selectedPlace?.countryCode = "JP"
        try expect(nonLatin.isValid && nonLatin.selectedPlace?.previewPlace.name == "", "Unsupported legacy navigation label does not invalidate saved data")
        try expect(nonLatin.toPreviewContext() == nil, "An empty non-Latin legacy label cannot create an invalid native context")
        var mixedLabels = value
        var nonLatinSaved = nonLatin.selectedPlace!
        nonLatinSaved.id = "tokyo"; nonLatinSaved.legacyIDType = nil
        mixedLabels.savedPlaces.append(nonLatinSaved)
        try expect(mixedLabels.isValid && mixedLabels.savedPlaces.count == 3, "All valid saved records remain in authoritative source")
        try expect(mixedLabels.toPreviewContext()?.savedPlaces.count == 2, "Only unsupported saved display records are filtered from disposable preview")
        try expect(mixedLabels.toPreviewContext()?.selectedPlace.id == value.selectedPlace?.id, "Unsupported saved label cannot block a valid selected forecast")
        try expect(value.toPreviewContext()?.selectedPlace.timezone == "America/Chicago", "Native context keeps time zone")
        try expect(value.toPreviewContext(locale: Locale(identifier: "en_US"))?.uses24HourClock == false, "Auto follows a 12-hour locale")
        try expect(value.toPreviewContext(locale: Locale(identifier: "en_GB"))?.uses24HourClock == true, "Auto follows a 24-hour locale")
        var explicit = value
        explicit.preferences.timeFormat = "24"
        explicit.preferences.unit = "celsius"
        explicit.preferences.theme = "dark"
        try expect(explicit.toPreviewContext(locale: Locale(identifier: "en_US"))?.uses24HourClock == true, "Explicit 24-hour clock overrides locale")
        try expect(explicit.toPreviewContext()?.metric == true && explicit.toPreviewContext()?.theme == "dark", "Preview resolves units and theme")
        explicit.preferences.timeFormat = "12"
        try expect(explicit.toPreviewContext(locale: Locale(identifier: "en_GB"))?.uses24HourClock == false, "Explicit 12-hour clock overrides locale")
        try expect(value.preferences.timeFormat == "auto", "Conversion must not overwrite raw Auto")

        var duplicateCoordinates = value
        duplicateCoordinates.savedPlaces[1].latitude = duplicateCoordinates.savedPlaces[0].latitude
        duplicateCoordinates.savedPlaces[1].longitude = duplicateCoordinates.savedPlaces[0].longitude
        try expect(duplicateCoordinates.isValid, "Same coordinates with distinct IDs must remain valid")
        try expect(duplicateCoordinates.toPreviewContext()?.savedPlaces.count == 2, "Context saved list must preserve distinct IDs")
        duplicateCoordinates.savedPlaces[1].id = duplicateCoordinates.savedPlaces[0].id
        try expect(!duplicateCoordinates.isValid, "Duplicate IDs are invalid")

        var bad = value
        bad.owner = "native"
        try expect(bad.isValid && bad.toPreviewContext() != nil, "Verified native ownership is accepted without changing display validation")
        try expect(try JSONDecoder().decode(NativePlacesSource.self, from: JSONEncoder().encode(bad)) == bad, "Native source round trips through strict decoding")
        bad.owner = "cloud"
        try expect(!bad.isValid, "Unknown ownership is rejected")
        try expect((try? JSONDecoder().decode(NativePlacesSource.self, from: JSONEncoder().encode(bad))) == nil, "Strict source decoder rejects unknown ownership")
        bad = value; bad.hydration = "loading"
        try expect(!bad.isValid, "Incomplete hydration rejected")
        bad = value; bad.version = 2
        try expect(!bad.isValid, "Future source version rejected")
        for stamp in ["2026-02-30T19:00:00.000Z", "2026-09-18T24:00:00Z", "2026-09-18T19:00:00-05:00", "yesterday"] {
            bad = value; bad.capturedAt = stamp
            try expect(!bad.isValid, "Malformed capture date rejected")
        }
        bad = value; bad.savedPlaces[0].latitude = .nan
        try expect(!bad.isValid, "Nonfinite coordinates rejected")
        bad = value; bad.savedPlaces[0].longitude = -181
        try expect(!bad.isValid, "Out-of-range coordinates rejected")
        bad = value; bad.savedPlaces[0].alias = "Home\u{0085}"
        try expect(!bad.isValid, "C1 control characters rejected")
        bad = value; bad.savedPlaces[0].alias = "Family 👨‍👩‍👧‍👦"
        try expect(bad.isValid, "ZWJ family emoji aliases preserved")
        bad = value; bad.savedPlaces[0].id = "04243918"
        try expect(!bad.isValid, "Numeric ID metadata requires canonical positive integer")
        bad = value; bad.savedPlaces[0].timezone = "Missing/Zone"
        try expect(!bad.isValid, "Unknown time zone rejected")
        bad = value; bad.preferences.timeFormat = "25"
        try expect(!bad.isValid, "Unknown clock value rejected")
        bad = value; bad.savedPlaces = Array(repeating: place(), count: 61)
        try expect(!bad.isValid, "Oversized inventory rejected")

        var empty = value
        empty.selectedPlace = nil; empty.lastPlace = nil; empty.savedPlaces = []
        let bytes = try JSONEncoder().encode(empty)
        let object = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
        try expect(object["selectedPlace"] is NSNull && object["lastPlace"] is NSNull, "Complete inventory encodes explicit nulls")
        try expect(try JSONDecoder().decode(NativePlacesSource.self, from: bytes) == empty, "Empty source round trips")
        try expect(empty.toPreviewContext() == nil, "No selected place does not fabricate a context")
        empty.owner = "native"
        try expect(try JSONDecoder().decode(NativePlacesSource.self, from: JSONEncoder().encode(empty)) == empty && empty.toPreviewContext() == nil,
            "Native ownership preserves an explicitly empty inventory without fabricating a display context")
        let sourceObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as! [String: Any]
        var malformedObjects: [[String: Any]] = []
        var missing = sourceObject; missing.removeValue(forKey: "selectedPlace"); malformedObjects.append(missing)
        var unknown = sourceObject; unknown["plans"] = []; malformedObjects.append(unknown)
        var invalidPlace = sourceObject["selectedPlace"] as! [String: Any]
        invalidPlace["latitude"] = true
        var booleanCoordinate = sourceObject; booleanCoordinate["selectedPlace"] = invalidPlace; malformedObjects.append(booleanCoordinate)
        invalidPlace = sourceObject["selectedPlace"] as! [String: Any]; invalidPlace["alias"] = NSNull()
        var nullAlias = sourceObject; nullAlias["selectedPlace"] = invalidPlace; malformedObjects.append(nullAlias)
        invalidPlace = sourceObject["selectedPlace"] as! [String: Any]; invalidPlace["notificationToken"] = "not allowed"
        var unexpectedField = sourceObject; unexpectedField["selectedPlace"] = invalidPlace; malformedObjects.append(unexpectedField)
        for item in malformedObjects {
            let malformed = try JSONSerialization.data(withJSONObject: item)
            try expect((try? JSONDecoder().decode(NativePlacesSource.self, from: malformed)) == nil, "Strict decoder rejects malformed or expanded inventory")
        }
        let command = NativePlacesCommand(action: "select", place: place(), expectedSource: empty)
        let commandRoundTrip = try JSONDecoder().decode(NativePlacesCommand.self, from: JSONEncoder().encode(command))
        try expect(commandRoundTrip == command && commandRoundTrip.place?.legacyIDType == "number", "Command preserves exact source and legacy numeric identity")
        var reply = NativePlacesReply(requestID: command.requestID, ok: true, source: value)
        try expect(reply.isValid(for: command), "Correlated reply accepted")
        reply.requestID = UUID().uuidString
        try expect(!reply.isValid(for: command), "Unrelated response rejected")
        reply.requestID = command.requestID; reply.version = 2
        try expect(!reply.isValid(for: command), "Future response rejected")
        let skyPatch = NativePlacesPreferencePatch(reactiveSkyEnabled: true, reactiveSkyMotionAllowed: false)
        try expect(skyPatch.isValid && NativePlacesPreferencePatch(reactiveSkyEnabled: false).isValid, "Boolean-only preference patches retain explicit false intent")
        try expect(try JSONDecoder().decode(NativePlacesPreferencePatch.self, from: JSONEncoder().encode(skyPatch)) == skyPatch,
            "Sky preference patches round trip without platform permission state")
        for raw in [#"{}"#, #"{"reactiveSkyEnabled":1}"#, #"{"reactiveSkyMotionAllowed":null}"#,
                    #"{"reactiveSkyEnabled":true,"permission":"granted"}"#] {
            try expect((try? JSONDecoder().decode(NativePlacesPreferencePatch.self, from: Data(raw.utf8))) == nil,
                "Strict preference decoder rejects malformed or expanded patches")
        }
    }

    @MainActor
    static func editsAndPreferences() async throws {
        let writer = Writer()
        let model = NativePlacesControlsModel { try await writer.call($0) }
        let beforeLoad = await model.setPreference(unit: "celsius")
        try expect(!beforeLoad && writer.commands.isEmpty, "Mutations require a verified inventory")
        await model.reload()
        try expect(model.source != nil && model.errorMessage == nil && !model.isBusy, "Reload verifies the source")
        let before = model.source
        let changed = await model.setPreference(unit: "celsius", clock: "24", theme: "dark")
        try expect(changed && model.source?.preferences.unit == "celsius" && model.source?.preferences.timeFormat == "24" && model.source?.preferences.theme == "dark", "Preferences update only after confirmation")
        try expect(writer.commands.last?.expectedSource == before, "Mutation carries exact last confirmed source")
        try expect(writer.commands.last?.preferences?.timeFormat == "24", "Clock uses timeFormat in wire patch")
        try expect(model.source?.preferences.reactiveSkyEnabled == false && model.source?.preferences.reactiveSkyMotionAllowed == true, "Unedited raw preferences survive")
        let auto = await model.setPreference(clock: "auto", theme: "auto")
        try expect(auto && model.source?.preferences.timeFormat == "auto", "Raw Auto remains raw")
        try expect(await model.setPreference(reactiveSkyEnabled: true, reactiveSkyMotionAllowed: false), "Sky and motion intent use the same confirmed preference transaction")
        try expect(model.source?.preferences.reactiveSkyEnabled == true && model.source?.preferences.reactiveSkyMotionAllowed == false,
            "Confirmed sky settings include explicit motion opt-out")
        try expect(writer.commands.last?.preferences?.reactiveSkyEnabled == true && writer.commands.last?.preferences?.reactiveSkyMotionAllowed == false,
            "Sky and motion values reach the writer without a platform permission request")
        let added = place("family", name: "Family town", numeric: false)
        try expect(await model.save(place: added), "Save succeeds with verified presence")
        try expect(await model.select(place: added), "Selection succeeds with verified identity")
        try expect(model.source?.selectedPlace?.id == "family", "Selected ID updates")
        try expect(await model.rename(id: "family", alias: "  Grandma   House  "), "Rename succeeds")
        try expect(model.source?.savedPlaces.last?.alias == "Grandma House", "Rename matches existing alias whitespace normalization")
        try expect(await model.move(id: "family", direction: -1), "Reorder succeeds")
        try expect(model.source?.savedPlaces.map(\.id) == ["4243918", "family", "spare"], "Reorder receipt matches exact order")
        try expect(await model.remove(id: "family"), "Remove succeeds with verified absence")
        try expect(await model.useCurrentLocation(), "Current location succeeds when following is confirmed")
        try expect(model.source?.selectedPlace?.followsCurrentLocation == true, "Current location follows explicitly")
        let callCount = writer.commands.count
        try expect(!(await model.setPreference(clock: "25")), "Invalid preference rejected")
        try expect(!(await model.move(id: "missing", direction: 1)), "Unknown row rejected")
        try expect(!(await model.rename(id: "spare", alias: String(repeating: "a", count: 37))), "Oversized alias rejected")
        try expect(writer.commands.count == callCount, "Invalid mutations never reach writer")
    }

    @MainActor
    static func unsupportedPreviewLabels() async throws {
        let writer = Writer()
        let model = NativePlacesControlsModel { try await writer.call($0) }
        await model.reload()
        var unsupported = place("tokyo", name: "東京", numeric: false)
        unsupported.admin1 = "東京都"; unsupported.country = "日本"; unsupported.countryCode = "JP"
        let callsBeforeSelect = writer.commands.count
        try expect(!(await model.select(place: unsupported)), "Unsupported selected label cannot close Places successfully")
        try expect(writer.commands.count == callsBeforeSelect, "Unsupported selection is rejected before writer dispatch")
        try expect(model.errorMessage?.contains("Open existing Nearcast") == true, "Unsupported selection offers the existing Nearcast fallback")
        try expect(await model.save(place: unsupported), "Unsupported display labels can still be safely saved")
        try expect(model.source?.savedPlaces.count == 3 && model.source?.toPreviewContext()?.savedPlaces.count == 2,
            "Saving preserves the full source but filters only disposable display context")

        let current = unsupported
        writer.replyOverride = { command in
            var receipt = fixture()
            receipt.capturedAt = "2026-09-18T20:00:00Z"
            receipt.selectedPlace = current
            receipt.selectedPlace?.followsCurrentLocation = true
            return NativePlacesReply(requestID: command.requestID, ok: true, source: receipt)
        }
        try expect(!(await model.useCurrentLocation()), "Unsupported current-location receipt must not close Places onto old forecast")
        try expect(model.source?.selectedPlace?.id == unsupported.id && model.source?.toPreviewContext() == nil,
            "Unsupported current-location receipt remains the verified source without an invalid preview")
        try expect(model.errorMessage?.contains("Your change is saved") == true && model.errorMessage?.contains("Open existing Nearcast") == true,
            "Confirmed write plus display limitation is distinguished from save failure")
        writer.replyOverride = { command in
            var receipt = fixture()
            receipt.capturedAt = "2026-09-18T20:01:00Z"
            receipt.selectedPlace = current
            receipt.preferences.theme = "dark"
            return NativePlacesReply(requestID: command.requestID, ok: true, source: receipt)
        }
        try expect(!(await model.setPreference(theme: "dark")), "Mutation cannot report a closable success without selected preview context")
        try expect(model.source?.preferences.theme == "dark" && model.errorMessage?.contains("Your change is saved") == true,
            "A saved preference is not misrepresented as a failed write when preview cannot refresh")
    }

    @MainActor
    static func failureAndFreshness() async throws {
        let writer = Writer()
        let model = NativePlacesControlsModel { try await writer.call($0) }
        await model.reload()
        let original = model.source
        writer.replyOverride = { _ in throw TestFailure.failed("network failure") }
        try expect(!(await model.setPreference(unit: "celsius")), "Transport failure cannot claim success")
        try expect(model.source == original && model.errorMessage?.contains("may have been saved") == true, "Transport failure keeps last verified source and uncertainty")
        let callCount = writer.commands.count
        await Task.yield()
        try expect(writer.commands.count == callCount, "No automatic write retry")
        await model.reload()
        try expect(model.source == original, "Failed reload retains confirmed data")
        writer.replyOverride = { command in NativePlacesReply(requestID: UUID().uuidString, ok: true, source: fixture()) }
        await model.reload()
        try expect(model.source == original && model.errorMessage != nil, "Mismatched receipt cannot replace source")
        writer.replyOverride = { command in
            var old = fixture(); old.capturedAt = "2026-09-18T18:59:59Z"
            return NativePlacesReply(requestID: command.requestID, ok: true, source: old)
        }
        await model.reload()
        try expect(model.source == original && model.errorMessage != nil, "Stale snapshot cannot roll state back")
        writer.replyOverride = { command in
            var malformed = fixture(); malformed.owner = "unknown"
            return NativePlacesReply(requestID: command.requestID, ok: true, source: malformed)
        }
        try expect(!(await model.setPreference(theme: "dark")) && model.source == original, "Malformed mutation receipt cannot replace source")
        writer.replyOverride = { command in NativePlacesReply(requestID: command.requestID, ok: true, source: original) }
        try expect(!(await model.setPreference(theme: "dark")), "ok alone cannot falsely confirm a preference change")
        try expect(model.errorMessage?.contains("could not be verified") == true, "Effect mismatch is explained")
        writer.replyOverride = { command in
            var partial = fixture(); partial.capturedAt = "2026-09-18T20:00:00Z"; partial.preferences.theme = "dark"
            return NativePlacesReply(requestID: command.requestID, ok: false, source: partial,
                message: "The change may have been saved. Reopen Places to verify before trying again.", code: "verification")
        }
        try expect(!(await model.setPreference(theme: "dark")), "Partial failure must remain a failure")
        try expect(model.source?.preferences.theme == "dark" && model.errorMessage?.contains("may have been saved") == true, "Partial failure can update verified truth without claiming success")
        writer.replyOverride = { command in NativePlacesReply(requestID: command.requestID, ok: true) }
        try expect(!(await model.remove(id: "spare")), "Missing source cannot confirm deletion")
        try expect(model.source?.savedPlaces.count == 2, "Unverified deletion does not optimistically remove a row")
    }

    @MainActor
    static func raceAndCancellation() async throws {
        let writer = Writer()
        let model = NativePlacesControlsModel { try await writer.call($0) }
        await model.reload()
        writer.heldActions = ["preferences"]
        let first = Task { @MainActor in await model.setPreference(unit: "celsius") }
        try await writer.waitForCommands(2)
        try expect(model.isBusy && model.source?.preferences.unit == "fahrenheit", "Pending writes do not optimistically change values")
        let duplicate = await model.setPreference(theme: "dark")
        try expect(!duplicate && writer.commands.count == 2, "Concurrent mutations are blocked, not queued")
        await model.reload()
        try expect(writer.commands.count == 2, "Reload cannot race an in-flight write")
        writer.resolve(writer.commands[1])
        try expect(await first.value && !model.isBusy, "First mutation completes normally")
        writer.heldActions = ["search"]
        let firstSearch = Task { @MainActor in await model.search(query: "Maryville") }
        try await writer.waitForCommands(3)
        let secondSearch = Task { @MainActor in await model.search(query: "Nokomis") }
        try await writer.waitForCommands(4)
        let commandOne = writer.commands[2], commandTwo = writer.commands[3]
        let secondPlace = place("search-two", name: "Nokomis", numeric: false)
        writer.resolve(commandTwo, reply: NativePlacesReply(requestID: commandTwo.requestID, ok: true, results: [secondPlace]))
        await secondSearch.value
        try expect(model.searchResults == [secondPlace] && !model.isSearching, "Latest search renders immediately")
        writer.resolve(commandOne, reply: NativePlacesReply(requestID: commandOne.requestID, ok: true, results: [place()]))
        await firstSearch.value
        try expect(model.searchResults == [secondPlace], "Slow older search cannot overwrite latest results")
        let thirdSearch = Task { @MainActor in await model.search(query: "Paris") }
        try await writer.waitForCommands(5)
        await model.search(query: "")
        writer.resolve(writer.commands[4], reply: NativePlacesReply(requestID: writer.commands[4].requestID, ok: true, results: [place()]))
        await thirdSearch.value
        try expect(model.searchResults.isEmpty && !model.isSearching, "Clearing query invalidates old search")
        let sourceBeforeCancel = model.source
        writer.heldActions = ["preferences"]
        let cancellation = Task { @MainActor in await model.setPreference(theme: "dark") }
        try await writer.waitForCommands(6)
        cancellation.cancel()
        writer.resolve(writer.commands[5])
        try expect(!(await cancellation.value) && model.source == sourceBeforeCancel, "Cancelled write does not fabricate a confirmed result")
        try expect(model.errorMessage?.contains("may have been saved") == true && !model.isBusy, "Cancelled dispatched write explains uncertainty and clears busy")
        try expect(writer.commands.count == 6, "Cancellation never replays a write")
        writer.heldActions = []
        await model.reload()
        try expect(model.source?.preferences.theme == "dark" && model.errorMessage == nil, "Explicit reload reconciles an uncertain committed write")
    }

    @MainActor
    static func nativeOwnerAdoption() async throws {
        let writer = Writer()
        let model = NativePlacesControlsModel { try await writer.call($0) }
        await model.reload()
        var native = model.source!
        native.owner = "native"
        try expect(model.adoptVerifiedSource(native), "Owner-only native handover can preserve the source capture timestamp")
        try expect(model.source?.owner == "native", "External committed native source becomes visible")
        native.capturedAt = "2026-09-18T20:00:00Z"
        native.preferences.reactiveSkyEnabled = true
        try expect(model.adoptVerifiedSource(native), "Newer committed native preferences are adopted")
        try expect(model.adoptVerifiedSource(native), "Identical native receipts are idempotent")
        var stale = native
        stale.capturedAt = "2026-09-18T19:59:59Z"
        try expect(!model.adoptVerifiedSource(stale), "Older native receipt cannot roll external state back")
        var conflict = native
        conflict.preferences.unit = "celsius"
        try expect(!model.adoptVerifiedSource(conflict), "Equal timestamp with different native contents is rejected")
        conflict.owner = "legacy"
        conflict.capturedAt = "2026-09-18T21:00:00Z"
        try expect(!model.adoptVerifiedSource(conflict), "External adoption never transfers native ownership back to legacy")
        let futureLegacy = conflict
        writer.replyOverride = { command in NativePlacesReply(requestID: command.requestID, ok: true, source: futureLegacy) }
        await model.reload()
        try expect(model.source == native, "A newly loaded legacy fallback cannot replace native ownership")

        writer.replyOverride = nil
        writer.heldActions = ["preferences"]
        let change = Task { @MainActor in await model.setPreference(unit: "celsius") }
        try await writer.waitForCommands(3)
        var external = native
        external.capturedAt = "2026-09-18T22:00:00Z"
        external.preferences.theme = "dark"
        try expect(model.isBusy && model.adoptVerifiedSource(external), "Verified external commits remain visible during an in-flight write")
        let pending = writer.commands[2]
        var olderReply = native
        olderReply.capturedAt = "2026-09-18T21:00:00Z"
        olderReply.preferences.unit = "celsius"
        writer.resolve(pending, reply: NativePlacesReply(requestID: pending.requestID, ok: true, source: olderReply))
        try expect(!(await change.value) && model.source == external && !model.isBusy, "Late older write receipt cannot replace the newer externally adopted commit")

        external.capturedAt = "2026-09-18T23:00:00Z"
        external.selectedPlace = nil
        external.lastPlace = nil
        external.savedPlaces = []
        try expect(model.adoptVerifiedSource(external) && model.source?.savedPlaces.isEmpty == true && model.source?.toPreviewContext() == nil,
            "Verified native empty source is retained without creating an old or invented forecast context")
    }
}
