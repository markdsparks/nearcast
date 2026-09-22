import Foundation

@main
struct NativePlansAndAskTests {
    @MainActor static func main() async throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("Library")
        let place = NativePreviewPlace(id: "maryville", name: "Maryville, Illinois", latitude: 38.72, longitude: -89.95, timezone: "America/Chicago", countryCode: "US")
        let agendaPlace = NativeAgendaPlace(preview: place)
        let calendar = try NativePlanSchedule.calendar(agendaPlace)
        func date(_ day: String, _ hour: Double) -> Date { NativePlanSchedule.date(day, hour: hour, calendar: calendar)! }
        let now = date("2026-09-20", 10)
        let plan = try NativePlanSchedule.make(title: "Soccer", place: agendaPlace, start: date("2026-09-22", 18), end: date("2026-09-22", 19), now: now)
        let library = NativePlanLibrary(directory: directory)
        try library.save(plan, replacing: nil)
        assert(library.plans.count == 1)
        assert(NativePlanLibrary(directory: directory).plans == [plan], "A saved plan survives process recreation")
        let edited = try NativePlanSchedule.make(title: "Soccer practice", place: agendaPlace, start: date("2026-09-22", 17), end: date("2026-09-22", 19), weekdays: [2, 4], existing: plan, now: now)
        try library.save(edited, replacing: plan)
        assert(library.plans[0].routine?.weekdays == [2, 4])
        do { try library.save(edited, replacing: plan); fatalError("Stale edit accepted") } catch NativePlanWriteError.conflict { }
        assert(NativePlanLibrary(directory: directory).plans == [edited])
        try library.delete(edited)
        assert(NativePlanLibrary(directory: directory).plans.isEmpty)

        let trip = try NativePlanSchedule.make(title: "Camping", place: agendaPlace, start: date("2026-09-22", 16), end: date("2026-09-24", 11), now: now)
        assert(trip.windows.count == 3 && trip.span != nil)
        assert(NativeAgenda(capturedAt: now, plans: [trip]).items(from: now).count == 1, "A trip appears once")
        let midnight = try NativePlanSchedule.make(title: "Evening", place: agendaPlace, start: date("2026-09-22", 18), end: date("2026-09-23", 0), now: now)
        assert(midnight.windows.count == 1 && midnight.endHour == 24)
        assert(NativePlanSchedule.date("2026-03-08", hour: 2.5, calendar: calendar) == nil, "Reject nonexistent spring-forward time")
        assert(NativePlanSchedule.date("2026-03-08", hour: 4, calendar: calendar) != nil)
        do { _ = try NativePlanSchedule.make(title: "", place: agendaPlace, start: now, end: now); fatalError("Invalid plan accepted") } catch { }

        let imported = NativeAgenda(capturedAt: now, plans: [plan])
        guard case .ready(planCount: 1) = library.legacyHandoffState(for: imported) else {
            fatalError("A verified retained agenda should require an explicit native handoff")
        }
        _ = try library.handoffVerifiedLegacyAgenda(imported)
        let nativeCopy = library.plans[0]
        assert(nativeCopy.id != plan.id, "A native edit must not retarget an earlier notification watch")
        guard case .local(let resolvedLocal) = library.resolveRoutePlan(id: nativeCopy.id) else {
            fatalError("A native Plans route should resolve the exact local plan")
        }
        assert(resolvedLocal == nativeCopy)
        guard case .importedCopy(let resolvedCopy) = library.resolveRoutePlan(id: plan.id) else {
            fatalError("An earlier plan route should resolve its explicit local copy")
        }
        assert(resolvedCopy == nativeCopy, "A legacy route opens the imported local copy, never the earlier record")
        assert(library.resolveRoutePlan(id: "\u{0000}bad") == .unavailable,
               "Malformed route IDs cannot select a saved plan")
        guard case .alreadyCompleted = try library.handoffVerifiedLegacyAgenda(imported) else {
            fatalError("A completed native handoff must not replay an earlier projection")
        }
        assert(library.plans.count == 1)
        try library.delete(nativeCopy)
        assert(library.resolveRoutePlan(id: plan.id) == .unavailable,
               "A deleted imported copy stays unavailable rather than resurrecting from an old route")
        _ = try library.handoffVerifiedLegacyAgenda(imported)
        assert(library.plans.isEmpty, "A deleted imported copy cannot resurrect")
        let reopened = NativePlanLibrary(directory: directory)
        _ = try reopened.handoffVerifiedLegacyAgenda(imported)
        assert(reopened.plans.isEmpty)
        assert(reopened.resolveRoutePlan(id: plan.id) == .unavailable,
               "An old route remains unavailable after a restart; it cannot recreate a local plan or touch a watch")

        let broken = directory.appendingPathComponent("plans.v1.json")
        let originalData = try Data(contentsOf: broken)
        try Data("bad-store".utf8).write(to: broken)
        let blocked = NativePlanLibrary(directory: directory)
        assert(blocked.error != nil)
        do { try blocked.save(plan, replacing: nil); fatalError("Overwrote corrupt store") } catch { }
        let retainedData = try Data(contentsOf: broken)
        assert(retainedData == Data("bad-store".utf8))
        try originalData.write(to: broken)

        let context = NativePreviewContext(version: 1, selectedPlace: place, savedPlaces: [], metric: false, uses24HourClock: true, theme: "auto")
        let chatFile = directory.appendingPathComponent("chat.json")
        var prompts: [String] = []
        var outputAction = "hourly"
        var outputDay = "2026-09-22"
        let chat = NativeAskConversation(file: chatFile, generator: { options in
            let messages = options["messages"] as! [[String: String]]
            prompts.append(messages.last!["content"]!)
            let result: [String: Any] = ["action": outputAction, "placeIndex": 0, "placeQuery": "", "dates": [outputDay],
                "startHour": 18, "endHour": 19, "title": "Soccer", "weekdays": [3], "clarification": ""]
            return ["ok": true, "text": String(data: try! JSONSerialization.data(withJSONObject: result), encoding: .utf8)!]
        })
        chat.send("Show Tuesday’s hourly forecast.", context: context, day: now)
        await settle(chat)
        assert(chat.messages.last?.target?.place == place)
        assert(calendar.isDate(chat.messages.last!.target!.day, inSameDayAs: date(outputDay, 12)))
        outputDay = "2026-09-23"
        chat.send("What about Wednesday?", context: context, day: now)
        await settle(chat)
        assert(prompts.last!.contains("Show Tuesday’s hourly forecast."), "Follow-up receives earlier conversation")
        assert(prompts.last!.contains("Maryville, Illinois"))
        assert(calendar.isDate(chat.messages.last!.target!.day, inSameDayAs: date(outputDay, 12)))
        assert(NativeAskConversation(file: chatFile).messages == chat.messages, "Chat and actions survive reopening")
        let staleIntent = NativeAskIntent(action: .forecast, placeIndex: 0, placeQuery: "",
            dates: ["2026-09-20"], startHour: -1, endHour: -1, title: "", weekdays: [], clarification: "")
        assert(NativeAskLocalRouting.deniesSuppliedForecast("The forecast does not include afternoon hours for Sep 22, so no reliable window can be determined from current data."))
        assert(NativeAskLocalRouting.deniesSuppliedForecast("The available forecast doesn’t cover that time."))
        assert(!NativeAskLocalRouting.deniesSuppliedForecast("Rain is not likely during the supplied forecast hours."))
        let grounded = NativeAskLocalRouting.groundRelativeForecastTime(staleIntent,
            query: "Would tomorrow afternoon be a good time for a one-hour walk in Maryville, Illinois?",
            place: place, day: now, hour: nil, now: date("2026-09-21", 18))
        assert(grounded.dates == ["2026-09-22"] && grounded.startHour == 12 && grounded.endHour == 18,
               "Explicit tomorrow afternoon must override stale model/history dates and times")
        let unchanged = NativeAskLocalRouting.groundRelativeForecastTime(staleIntent,
            query: "What about the wind?", place: place, day: now, hour: nil, now: date("2026-09-21", 18))
        assert(unchanged.dates == staleIntent.dates, "Unspecified follow-ups preserve conversation dates")
        let relativeChat = NativeAskConversation(file: directory.appendingPathComponent("relative-chat.json"),
            generator: { _ in
                let result: [String: Any] = ["action": "hourly", "placeIndex": 0, "placeQuery": "",
                    "dates": ["2026-09-20"], "startHour": -1, "endHour": -1,
                    "title": "", "weekdays": [], "clarification": ""]
                return ["ok": true, "text": String(data: try! JSONSerialization.data(withJSONObject: result), encoding: .utf8)!]
            }, now: { date("2026-09-21", 18) })
        relativeChat.send("Show tomorrow afternoon's hourly forecast", context: context, day: now)
        await settle(relativeChat)
        assert(relativeChat.messages.last?.target?.hour == date("2026-09-22", 12),
               "Conversation execution uses deterministic tomorrow, despite a stale generated date")
        outputAction = "plan"
        chat.send("Create soccer Wednesday 6–7 PM", context: context, day: now)
        await settle(chat)
        assert(chat.messages.last?.plan != nil, "Plan request produces a reviewable draft")
        assert(chat.messages.last?.plan?.routine == nil, "A model-suggested weekday cannot make a one-time request weekly")
        assert(!NativeAskEvidence.explicitlyRequestsRecurrence(["Wednesday at 6 PM", "5 to 6 pm"]))
        assert(NativeAskEvidence.explicitlyRequestsRecurrence(["A walk every Sunday from 5 to 6 pm"]))
        assert(reopened.plans.isEmpty, "Inference alone never saves a plan")
        let oldDraftFile = directory.appendingPathComponent("old-draft.json")
        let oldDraft: [NativeAskMessage] = [.init(role: "user", text: "Soccer tomorrow from 5 to 7 pm"), .init(role: "assistant", text: "Review draft", plan: edited)]
        try JSONEncoder().encode(oldDraft).write(to: oldDraftFile)
        assert(NativeAskConversation(file: oldDraftFile).messages.last?.plan?.routine == nil, "An old unsaved draft cannot retain unauthorized recurrence")
        let weeklyDraft: [NativeAskMessage] = [.init(role: "user", text: "Soccer every Tuesday from 5 to 7 pm"), .init(role: "assistant", text: "Review draft", plan: edited)]
        try JSONEncoder().encode(weeklyDraft).write(to: oldDraftFile)
        assert(NativeAskConversation(file: oldDraftFile).messages.last?.plan?.routine != nil, "Explicit weekly drafts retain recurrence when restored")
        let messageID = chat.messages.last!.id
        chat.planSaved(plan, messageID: messageID)
        assert(chat.messages.last?.plan == nil && chat.messages.last?.showsPlans == true, "Saved confirmation cannot resubmit a duplicate draft")
        let failing = NativeAskConversation(file: directory.appendingPathComponent("failed-chat.json"),
            generator: { _ in ["ok": false, "message": "AI is not ready"] },
            forecastLoader: { _, _ in throw URLError(.notConnectedToInternet) })
        failing.send("Will it rain?", context: context, day: now)
        await settle(failing)
        assert(failing.messages.last?.retryQuestion == "Will it rain?")
        assert(failing.messages.last?.text == URLError(.notConnectedToInternet).localizedDescription,
               "Unavailable AI falls through to the native forecast reader; a forecast failure still supports retry")
        assert(!failing.isWorking)

        // Ask always lets a completed refresh win, but a valid matching
        // repository cache keeps a weather answer available when the refresh
        // itself fails. The returned source is explicit rather than inferred
        // from the forecast timestamp.
        let forecastDay = date("2026-09-22", 12)
        func sampleForecast(generatedAt: Date, temperature: Double) -> NativeWeatherForecast {
            .init(
                generatedAt: generatedAt,
                timezoneID: "America/Chicago",
                metric: false,
                current: nil,
                hours: [
                    .init(date: date("2026-09-22", 18), temperature: temperature, rainProbability: 65,
                          precipitationMM: 1, windSpeed: 8, windGusts: 14, weatherCode: 61,
                          isDay: true, origin: .hourlyForecast, precipitationIntervalSeconds: 3600)
                ],
                quarterHours: [],
                days: [.init(date: forecastDay, high: temperature + 2, low: temperature - 6,
                             rainProbability: 65, precipitationMM: 1, weatherCode: 61)]
            )
        }
        let savedForecast = sampleForecast(generatedAt: now.addingTimeInterval(-2 * 3600), temperature: 68)
        let refreshedForecast = sampleForecast(generatedAt: now, temperature: 70)
        let fallbackLoad = try await NativeAskForecastLoader.load(
            place: place,
            metric: false,
            cached: { _, _ in savedForecast },
            fetch: { _, _ in throw URLError(.notConnectedToInternet) }
        )
        assert(fallbackLoad.source == .savedAfterRefreshFailure,
               "A valid cache is marked as saved only after Ask refresh fails")
        assert(fallbackLoad.forecast.generatedAt == savedForecast.generatedAt,
               "Fallback preserves the forecast's original source time")
        let refreshedLoad = try await NativeAskForecastLoader.load(
            place: place,
            metric: false,
            cached: { _, _ in savedForecast },
            fetch: { _, _ in refreshedForecast }
        )
        assert(refreshedLoad.source == .refreshed && refreshedLoad.forecast.generatedAt == refreshedForecast.generatedAt,
               "A successful Ask refresh always wins over saved cache evidence")
        do {
            _ = try await NativeAskForecastLoader.load(
                place: place,
                metric: false,
                cached: { _, _ in nil },
                fetch: { _, _ in throw URLError(.notConnectedToInternet) }
            )
            fatalError("Ask accepted an unavailable refresh without a valid cache")
        } catch { }

        var outageAnswerPrompt = ""
        let outage = NativeAskConversation(
            file: directory.appendingPathComponent("outage-chat.json"),
            generator: { options in
                let schema = options["schema"] as? [String: Any]
                let properties = schema?["properties"] as? [String: Any]
                if properties?["answer"] != nil {
                    let messages = options["messages"] as? [[String: String]]
                    outageAnswerPrompt = messages?.last?["content"] ?? ""
                    return ["ok": true, "text": #"{"answer":"Rain is likely around 6:00 PM."}"#]
                }
                let result: [String: Any] = [
                    "action": "forecast", "placeIndex": 0, "placeQuery": "", "dates": ["2026-09-22"],
                    "startHour": -1, "endHour": -1, "title": "", "weekdays": [], "clarification": ""
                ]
                return ["ok": true, "text": String(data: try! JSONSerialization.data(withJSONObject: result), encoding: .utf8)!]
            },
            forecastLoader: { _, _ in fallbackLoad }
        )
        outage.send("Will it rain Tuesday?", context: context, day: now)
        await settle(outage)
        guard let outageAnswer = outage.messages.last else { fatalError("Ask did not produce a saved-forecast answer") }
        assert(outageAnswer.forecastSource == .savedAfterRefreshFailure,
               "The assistant message retains saved-cache provenance after the answer is generated")
        assert(outageAnswer.text.contains("saved forecast from") && outageAnswer.text.contains("may not match conditions now"),
               "Saved forecast answers carry an unavoidable freshness warning")
        assert(outageAnswer.evidence?.contains("Saved forecast · live refresh unavailable") == true,
               "Saved forecast evidence visibly states source and failed refresh")
        assert(outageAnswerPrompt.contains("SOURCE STATUS: A live refresh failed") && outageAnswerPrompt.contains("not live or current conditions"),
               "The on-device model receives strict saved-forecast provenance")
        chat.newChat()
        assert(NativeAskConversation(file: chatFile).messages.isEmpty)
        print("PASS Native Plans and Ask: durable CRUD, exact local/imported route focus, import isolation/tombstones, routines/spans/DST, persisted follow-ups, draft-only AI, failure/retry, saved-forecast Ask fallback")
    }
    @MainActor static func settle(_ chat: NativeAskConversation) async {
        for _ in 0..<1000 {
            if !chat.isWorking { return }
            try? await Task.sleep(for: .milliseconds(5))
        }
        fatalError("Native Ask failed to settle")
    }
}
