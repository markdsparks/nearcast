import Foundation

@main
struct NativeAgendaRepositoryTests {
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }

    static func expectsFailure(_ message: String, _ body: () throws -> Void) {
        do {
            try body()
            preconditionFailure(message)
        } catch {}
    }

    static func date(_ value: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)!
    }

    static func plan(id: String, title: String, place: [String: Any], targetDate: String,
                     startHour: Double, endHour: Double, windows: [[String: Any]],
                     scheduleType: String = "single", span: Any = NSNull(), routine: Any = NSNull()) -> [String: Any] {
        [
            "id": id,
            "kind": "plan",
            "title": title,
            "label": "Plan window",
            "original": "",
            "answer": "",
            "place": place,
            "targetDate": targetDate,
            "startHour": startHour,
            "endHour": endHour,
            "windows": windows,
            "scheduleType": scheduleType,
            "span": span,
            "routine": routine,
            "schemaVersion": 2,
            "scheduleId": id,
            "createdAt": 1_789_000_000_000,
            "updatedAt": 1_789_000_000_000
        ]
    }

    static func window(_ id: String, _ date: String, _ start: Double, _ end: Double,
                       label: String = "Plan window") -> [String: Any] {
        ["id": id, "targetDate": date, "startHour": start, "endHour": end, "label": label]
    }

    static func payload(
        _ plans: [[String: Any]],
        capturedAt: String = "2026-09-14T12:00:00.000Z"
    ) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "version": 1,
            "owner": "legacy",
            "hydration": "ready",
            "capturedAt": capturedAt,
            "plans": plans
        ], options: [.sortedKeys])
    }

    @MainActor
    static func main() throws {
        let chicago: [String: Any] = [
            "id": 12345,
            "name": "Maryville",
            "admin1": "Illinois",
            "country": "United States",
            "countryCode": "US",
            "latitude": 38.72,
            "longitude": -89.95,
            "timezone": "America/Chicago"
        ]
        let single = plan(id: "single", title: "Soccer", place: chicago, targetDate: "2026-09-15",
                          startHour: 17, endHour: 19,
                          windows: [window("single-window", "2026-09-15", 17, 19)])
        let routine = plan(id: "routine", title: "Walk", place: chicago, targetDate: "2026-09-14",
                           startHour: 8, endHour: 9,
                           windows: [window("routine-window", "2026-09-14", 8, 9)],
                           routine: ["frequency": "weekly", "weekdays": [1, 3], "weekday": 1,
                                     "focus": ["rain", "wind"]])
        let span = plan(id: "trip", title: "Camping", place: chicago, targetDate: "2026-09-15",
                        startHour: 15, endHour: 24,
                        windows: [
                            window("span-2026-09-15", "2026-09-15", 15, 24, label: "Starts"),
                            window("span-2026-09-16", "2026-09-16", 0, 24, label: "All day"),
                            window("span-2026-09-17", "2026-09-17", 0, 10, label: "Ends")
                        ], scheduleType: "continuous_span",
                        span: ["startDate": "2026-09-15", "startHour": 15,
                               "endDate": "2026-09-17", "endHour": 10])
        let discrete = plan(id: "practice", title: "Practice", place: chicago, targetDate: "2026-09-16",
                            startHour: 9, endHour: 10,
                            windows: [window("practice-a", "2026-09-16", 9, 10),
                                      window("practice-b", "2026-09-18", 9, 10)], scheduleType: "discrete")

        let agenda = try NativeAgendaRepository().decode(try payload([single, routine, span, discrete]))
        expect(agenda.plans.count == 4, "A verified export preserves every plan exactly once")
        expect(agenda.plans.first?.place.id == "12345" && agenda.plans.first?.place.legacyIDType == .number,
               "A numeric legacy place ID stays a numeric legacy identity")
        expect(agenda.plans.first?.scheduleID == "single", "Stable plan schedule IDs survive read-only import")

        // Monday Sep 14, 2026 at 07:30 in Chicago. The weekly routine occurs
        // Monday and Wednesday; neither occurrence writes the stored targetDate.
        let items = agenda.items(from: date("2026-09-14T12:30:00.000Z"))
        expect(items.filter { $0.planID == "routine" }.map(\.startDate) == ["2026-09-14", "2026-09-16", "2026-09-21"],
               "Weekly routines roll forward in the agenda without mutating memory")
        expect(items.filter { $0.planID == "trip" }.count == 1 &&
               items.first(where: { $0.planID == "trip" })?.kind == .continuousSpan,
               "A continuous multi-day plan appears once, not once per covered day")
        let afterTripEnds = agenda.items(from: date("2026-09-17T18:00:00.000Z"))
        expect(!afterTripEnds.contains(where: { $0.planID == "trip" }),
               "A continuous span ending earlier today is not kept in Agenda until midnight")
        expect(items.filter { $0.planID == "practice" }.count == 2,
               "A discrete plan retains each explicitly saved window")
        expect(items.allSatisfy { $0.planID != "single" || $0.startDate == "2026-09-15" },
               "A single plan retains its exact planned date")

        var broken = single
        broken["schemaVersion"] = 3
        expectsFailure("A future plan schema must not silently render as a native plan") {
            _ = try NativeAgendaRepository().decode(try payload([broken]))
        }

        broken = single
        broken["unexpected"] = true
        expectsFailure("Unknown fields require an explicit export/schema update") {
            _ = try NativeAgendaRepository().decode(try payload([broken]))
        }

        broken = single
        broken["targetDate"] = "2026-02-30"
        expectsFailure("Invalid civil dates must not enter a native agenda") {
            _ = try NativeAgendaRepository().decode(try payload([broken]))
        }

        broken = single
        broken["windows"] = [window("single-window", "2026-09-15", 19, 17)]
        expectsFailure("An invalid window cannot become an empty or altered plan") {
            _ = try NativeAgendaRepository().decode(try payload([broken]))
        }

        var untrusted = try JSONSerialization.jsonObject(with: payload([single])) as! [String: Any]
        untrusted["hydration"] = "loading"
        expectsFailure("An incomplete source is not confused with a known empty agenda") {
            _ = try NativeAgendaRepository().decode(try JSONSerialization.data(withJSONObject: untrusted))
        }

        let empty = try NativeAgendaRepository().decode(try payload([]))
        expect(empty.plans.isEmpty, "A verified explicit empty export remains a known empty agenda")

        expectsFailure("Raw local-storage JSON is never mistaken for a verified migration export") {
            _ = try NativeAgendaRepository().decode(try JSONSerialization.data(withJSONObject: [single]))
        }

        let suite = "nearcast-native-agenda-store-tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = NativeAgendaStore(defaults: defaults)
        expect(store.availability == .unavailable && store.agenda == nil,
            "A missing legacy export is unavailable, not a claimed empty agenda")
        let verifiedPayload = try payload([single])
        expect(store.acceptLegacyExport(verifiedPayload), "A verified legacy export becomes the native read-only cache")
        guard case let .ready(capturedAt, isEmpty) = store.availability else {
            preconditionFailure("A verified agenda must report its known readiness")
        }
        expect(!isEmpty && capturedAt == date("2026-09-14T12:00:00.000Z") && store.agenda?.plans.count == 1,
            "The native cache retains only validated legacy content")
        expect(!store.acceptLegacyExport(Data("not json".utf8)),
            "Malformed exports are rejected instead of overwriting a known agenda")
        guard case .retained = store.availability else {
            preconditionFailure("A bad new export must disclose retained prior data")
        }
        expect(store.agenda?.plans.count == 1,
            "A rejected export cannot erase a family's last verified Agenda")
        let reloaded = NativeAgendaStore(defaults: defaults)
        expect(reloaded.agenda?.plans.count == 1,
            "The verified export survives a native-only relaunch without becoming an owner")

        // A Local Dev page is a distinct legacy authority, even when it runs
        // on the same phone with the same UserDefaults suite. Production data
        // must not appear while Local is selected, and a source-tagged export
        // from the other authority must be rejected rather than cached here.
        let scopedSuite = "nearcast-native-agenda-scope-tests.\(UUID().uuidString)"
        let scopedDefaults = UserDefaults(suiteName: scopedSuite)!
        defer { scopedDefaults.removePersistentDomain(forName: scopedSuite) }
        let localPlan = plan(
            id: "local-only",
            title: "Local rehearsal",
            place: chicago,
            targetDate: "2026-09-16",
            startHour: 10,
            endHour: 11,
            windows: [window("local-window", "2026-09-16", 10, 11)]
        )
        let productionPayload = try payload(
            [single],
            capturedAt: "2026-09-14T12:00:00.000Z"
        )
        let localPayload = try payload(
            [localPlan],
            capturedAt: "2026-09-15T12:00:00.000Z"
        )
        let scopedStore = NativeAgendaStore(
            defaults: scopedDefaults,
            sourceScope: .remoteProduction
        )
        expect(scopedStore.acceptLegacyExport(productionPayload, sourceScope: .remoteProduction),
            "Production stores only its own verified legacy export")
        expect(scopedStore.agenda?.plans.map(\.id) == ["single"],
            "Production initially exposes its verified plan")

        scopedStore.configure(sourceScope: .localDevelopment)
        expect(scopedStore.sourceScope == .localDevelopment && scopedStore.agenda == nil && scopedStore.availability == .unavailable,
            "Switching to Local never reuses the Production agenda cache")
        expect(!scopedStore.acceptLegacyExport(productionPayload, sourceScope: .remoteProduction),
            "A production-tagged export is rejected while the Local scope is active")
        expect(scopedStore.agenda == nil && scopedStore.availability == .unavailable,
            "A rejected cross-scope export cannot populate Local from Production")
        expect(scopedStore.acceptLegacyExport(localPayload, sourceScope: .localDevelopment),
            "Local accepts its own verified export")
        expect(scopedStore.agenda?.plans.map(\.id) == ["local-only"],
            "Local exposes only its own verified plan")

        scopedStore.configure(sourceScope: .remoteProduction)
        expect(scopedStore.agenda?.plans.map(\.id) == ["single"],
            "Returning to Production restores the retained Production agenda, not Local data")
        scopedStore.configure(sourceScope: .localDevelopment)
        expect(scopedStore.agenda?.plans.map(\.id) == ["local-only"],
            "Returning to Local restores its separately retained agenda")
        let localReload = NativeAgendaStore(defaults: scopedDefaults, sourceScope: .localDevelopment)
        let productionReload = NativeAgendaStore(defaults: scopedDefaults, sourceScope: .remoteProduction)
        expect(localReload.agenda?.plans.map(\.id) == ["local-only"] &&
               productionReload.agenda?.plans.map(\.id) == ["single"],
            "Fresh stores preserve the Local and Production cache boundary across relaunch")

        print("PASS Native agenda repository: strict read-only legacy plan import and agenda derivation")
    }
}
