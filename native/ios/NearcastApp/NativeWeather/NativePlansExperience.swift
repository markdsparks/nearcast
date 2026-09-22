import SwiftUI

struct NativePlansExperience: View {
    let context: NativePreviewContext
    let day: Date
    let startCreating: Bool
    /// A bounded native route identifier. It may name either a local native
    /// plan or an earlier plan that has already been explicitly copied into
    /// this local library. It is never a request to create a copy, enable a
    /// watch, or change notification delivery.
    let initialPlanID: String?
    let onDone: () -> Void
    let onHourly: (NativeAgendaItem) -> Void
    /// Native-only Dev has no ambient WebKit host. This optional callback is
    /// an explicit, confirmed request to visit the exact existing Plans screen
    /// once for a read-only verified export—not a fallback from this view.
    let onRequestVerifiedLegacyHandoff: (() -> Void)?
    @ObservedObject private var library = NativePlanLibrary.shared
    @ObservedObject private var legacyAgenda = NativeAgendaStore.shared
    @State private var editor: NativePlanEditorRequest?
    @State private var selectedID: String?
    @State private var highlightedPlanID: String?
    @State private var unavailableRoutePlan = false
    @State private var openedImportedCopy = false
    @State private var showAll = false
    @State private var showingLegacyHandoffConfirmation = false
    @State private var legacyHandoffMessage: String?
    @State private var legacyHandoffError: String?

    init(
        context: NativePreviewContext,
        day: Date,
        startCreating: Bool = false,
        initialPlanID: String? = nil,
        onDone: @escaping () -> Void,
        onHourly: @escaping (NativeAgendaItem) -> Void,
        onRequestVerifiedLegacyHandoff: (() -> Void)? = nil
    ) {
        self.context = context
        self.day = day
        self.startCreating = startCreating
        self.initialPlanID = initialPlanID
        self.onDone = onDone
        self.onHourly = onHourly
        self.onRequestVerifiedLegacyHandoff = onRequestVerifiedLegacyHandoff
    }

    private var upcoming: [NativeAgendaPlan] {
        let items = NativeAgenda(capturedAt: Date(), plans: library.plans).items()
        var seen = Set<String>()
        return items.compactMap { item in
            guard seen.insert(item.planID).inserted else { return nil }
            return library.plans.first { $0.id == item.planID }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    Text("A little foresight for your time outside.")
                        .font(.title2.weight(.semibold)).padding(.top, 12)
                    if onRequestVerifiedLegacyHandoff != nil { legacyHandoffCard }
                    Picker("Plan list", selection: $showAll) {
                        Text("Upcoming").tag(false)
                        Text("All plans (\(library.plans.count))").tag(true)
                    }.pickerStyle(.segmented)
                    if let error = library.error {
                        Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    }
                    if unavailableRoutePlan {
                        ContentUnavailableView(
                            "Plan unavailable on this iPhone",
                            systemImage: "calendar.badge.exclamationmark",
                            description: Text("It may have been removed or has not been saved in native Plans. Earlier plans, watches, and notifications were not changed.")
                        )
                        .accessibilityIdentifier("plan.route.unavailable")
                    } else if openedImportedCopy {
                        Label("Opened a local native copy. Earlier watches and notifications are unchanged.",
                              systemImage: "checkmark.circle")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("plan.route.imported-copy")
                    }
                    let displayed = showAll ? library.plans.sorted { $0.targetDate < $1.targetDate } : upcoming
                    if displayed.isEmpty {
                        if !unavailableRoutePlan {
                            ContentUnavailableView(showAll || library.plans.isEmpty ? "Make room for a good day" : "Nothing in the next seven days",
                                systemImage: "calendar", description: Text("Save a walk, practice, trip, or weekly routine. Nearcast checks the weather for its place and time."))
                        }
                        Button("Create a plan") { editor = .init() }
                            .buttonStyle(.borderedProminent).frame(maxWidth: .infinity)
                    } else {
                        ForEach(displayed) { plan in
                            planRow(plan)
                        }
                    }
                    Text("Saved on this iPhone. Plans don’t enable notifications automatically.")
                        .font(.footnote).foregroundStyle(.secondary).padding(.top, 10)
                }.padding(20)
            }
            .navigationTitle("Plans")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Done", action: onDone) }
                ToolbarItem(placement: .topBarTrailing) { Button("New plan", systemImage: "plus") { editor = .init() } }
            }
            .navigationDestination(isPresented: Binding(get: { selectedPlan != nil }, set: { if !$0 { selectedID = nil } })) {
                if let plan = selectedPlan {
                    NativeOwnedPlanDetail(plan: plan, context: context, library: library,
                        onEdit: { editor = .init(existing: plan) },
                        onDeleted: { didDelete(plan) }, onHourly: onHourly)
                        .id(plan.updatedAtMilliseconds)
                }
            }
            .sheet(item: $editor) { request in
                NativePlanEditor(context: context, day: day, request: request) { plan in
                    editor = nil
                    open(plan)
                }
            }
            .task(id: initialPlanID) {
                if initialPlanID != nil {
                    applyRouteFocus()
                } else if startCreating {
                    editor = .init()
                }
            }
            .confirmationDialog(
                "Import saved plans?",
                isPresented: $showingLegacyHandoffConfirmation,
                titleVisibility: .visible
            ) {
                Button(importActionTitle) { handoffLegacyPlans() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This makes one native copy of the verified schedules on this iPhone. Existing plan notifications, Watch updates, and earlier saved Plans are not changed.")
            }
        }
    }

    @ViewBuilder
    private var legacyHandoffCard: some View {
        switch library.legacyHandoffState(
            for: legacyAgenda.agenda,
            sourceScope: legacyAgenda.sourceScope
        ) {
        case .ready(let planCount):
            VStack(alignment: .leading, spacing: 10) {
                Label("Bring saved plans into Nearcast", systemImage: "arrow.down.doc")
                    .font(.headline)
                Text(legacyHandoffDescription(planCount: planCount))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button(importActionTitle) { showingLegacyHandoffConfirmation = true }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("plan.handoff.import")
                    .accessibilityHint("Copies verified plan schedules into native Plans without changing notifications or Watch delivery")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(Color.accentColor.opacity(0.32), lineWidth: 1)
            }
            .accessibilityIdentifier("plan.handoff.available")

        case .completed(let receipt):
            VStack(alignment: .leading, spacing: 5) {
                Label("Saved plans are native", systemImage: "checkmark.circle")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(handoffCompletionDescription(receipt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("plan.handoff.complete")

        case .empty:
            if legacyAgenda.agenda != nil {
                Label("No verified saved plans are waiting to import", systemImage: "calendar")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("plan.handoff.empty")
            }

        case .unavailable:
            if let onRequestVerifiedLegacyHandoff {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Find existing saved plans", systemImage: "calendar.badge.clock")
                        .font(.headline)
                    Text("Import needs one verified read of the saved Plans already on this iPhone. Nearcast will ask before opening that screen, then you decide whether to copy the schedules here.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Find saved plans", action: onRequestVerifiedLegacyHandoff)
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("plan.handoff.find")
                        .accessibilityHint("Ask Nearcast to verify existing saved Plans before importing them")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(Color.accentColor.opacity(0.32), lineWidth: 1)
                }
                .accessibilityIdentifier("plan.handoff.unavailable")
            } else {
                Label("Saved plan import is not ready on this device", systemImage: "calendar.badge.exclamationmark")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("plan.handoff.unavailable")
            }
        }

        if let legacyHandoffMessage {
            Label(legacyHandoffMessage, systemImage: "checkmark.circle")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("plan.handoff.result")
        }
        if let legacyHandoffError {
            Label(legacyHandoffError, systemImage: "exclamationmark.triangle")
                .font(.subheadline)
                .foregroundStyle(.orange)
                .accessibilityIdentifier("plan.handoff.error")
        }
    }

    private var importActionTitle: String {
        guard case .ready(let planCount) = library.legacyHandoffState(
            for: legacyAgenda.agenda,
            sourceScope: legacyAgenda.sourceScope
        ) else {
            return "Import saved plans"
        }
        return planCount == 1 ? "Import 1 saved plan" : "Import \(planCount) saved plans"
    }

    private func legacyHandoffDescription(planCount: Int) -> String {
        let count = planCount == 1 ? "1 saved plan" : "\(planCount) saved plans"
        switch legacyAgenda.availability {
        case .retained:
            return "Nearcast has a last verified copy of \(count) on this iPhone. Import makes one native copy; it does not change existing notifications or Watch updates."
        case .ready:
            return "Nearcast found \(count) already verified on this iPhone. Import makes one native copy; it does not change existing notifications or Watch updates."
        case .unavailable:
            return "Import only becomes available after Nearcast verifies saved plans on this iPhone."
        }
    }

    private func handoffCompletionDescription(_ receipt: NativePlanLegacyHandoffReceipt) -> String {
        let available = receipt.availableNativeCopyCount
        if receipt.protectedDeletedCount > 0 {
            return "\(available) \(available == 1 ? "plan is" : "plans are") in native Plans. \(receipt.protectedDeletedCount) earlier \(receipt.protectedDeletedCount == 1 ? "plan stays" : "plans stay") removed here; nothing was restored. Notifications and Watch updates remain unchanged."
        }
        return "\(available) \(available == 1 ? "plan is" : "plans are") in native Plans. Notifications and Watch updates remain unchanged."
    }

    private func handoffLegacyPlans() {
        legacyHandoffError = nil
        legacyHandoffMessage = nil
        do {
            let result = try library.handoffVerifiedLegacyAgenda(
                legacyAgenda.agenda,
                sourceScope: legacyAgenda.sourceScope
            )
            let receipt = result.receipt
            if case .alreadyCompleted = result {
                legacyHandoffMessage = "Saved plans were already imported into native Plans."
            } else {
                let count = receipt.availableNativeCopyCount
                legacyHandoffMessage = count == 1
                    ? "1 saved plan is now available in native Plans."
                    : "\(count) saved plans are now available in native Plans."
            }
            if initialPlanID != nil {
                applyRouteFocus()
            }
        } catch {
            legacyHandoffError = error.localizedDescription
        }
    }

    private var selectedPlan: NativeAgendaPlan? {
        guard let selectedID else { return nil }
        return library.plans.first(where: { $0.id == selectedID })
    }

    private func planRow(_ plan: NativeAgendaPlan) -> some View {
        let isHighlighted = highlightedPlanID == plan.id
        return Button { open(plan) } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(plan.title).font(.headline)
                    Spacer()
                    if isHighlighted {
                        Label("Opened", systemImage: "arrow.turn.down.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tint)
                            .accessibilityHidden(true)
                    }
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                }
                Text(plan.place.displayName).font(.subheadline).foregroundStyle(.secondary)
                Text(NativePlanLabels.schedule(NativePlanSchedule.item(plan), clock24: context.uses24HourClock))
                    .font(.subheadline).foregroundStyle(.secondary)
                if plan.routine != nil { Label("Weekly routine", systemImage: "repeat").font(.caption) }
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(18)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
            .overlay {
                RoundedRectangle(cornerRadius: 20)
                    .strokeBorder(isHighlighted ? Color.accentColor.opacity(0.75) : .clear, lineWidth: 1.5)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(isHighlighted ? "plan.route.focused" : "plan.row")
        .accessibilityHint(isHighlighted ? "This is the plan opened from the route." : "Open plan details")
    }

    private func applyRouteFocus() {
        switch library.resolveRoutePlan(id: initialPlanID) {
        case .local(let plan):
            open(plan, importedCopy: false)
        case .importedCopy(let plan):
            open(plan, importedCopy: true)
        case .unavailable:
            selectedID = nil
            highlightedPlanID = nil
            unavailableRoutePlan = true
            openedImportedCopy = false
        }
    }

    private func open(_ plan: NativeAgendaPlan, importedCopy: Bool? = nil) {
        if !upcoming.contains(where: { $0.id == plan.id }) {
            showAll = true
        }
        selectedID = plan.id
        highlightedPlanID = plan.id
        unavailableRoutePlan = false
        openedImportedCopy = importedCopy ?? library.isImportedCopy(plan)
    }

    private func didDelete(_ plan: NativeAgendaPlan) {
        selectedID = nil
        if highlightedPlanID == plan.id {
            highlightedPlanID = nil
            unavailableRoutePlan = initialPlanID != nil
            openedImportedCopy = false
        }
    }
}

struct NativePlanEditorRequest: Identifiable {
    let id = UUID()
    var existing: NativeAgendaPlan? = nil
    var suggested: NativeAgendaPlan? = nil
}

private struct NativeEditableSlot: Identifiable {
    let id = UUID()
    var start: Date
    var end: Date
}

struct NativePlanEditor: View {
    let context: NativePreviewContext
    let request: NativePlanEditorRequest
    let onSaved: (NativeAgendaPlan) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var place: NativeAgendaPlace
    @State private var slots: [NativeEditableSlot]
    @State private var weekdays: Set<Int>
    @State private var repeats: Bool
    @State private var findingPlace = false
    @State private var reviewing: NativeAgendaPlan?
    @State private var error: String?

    init(context: NativePreviewContext, day: Date, request: NativePlanEditorRequest, onSaved: @escaping (NativeAgendaPlan) -> Void) {
        self.context = context; self.request = request; self.onSaved = onSaved
        let plan = request.existing ?? request.suggested
        let place = plan?.place ?? NativeAgendaPlace(preview: context.selectedPlace)
        _place = State(initialValue: place)
        _title = State(initialValue: plan?.title ?? "")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = place.timezone.flatMap(TimeZone.init(identifier:)) ?? .current
        var start = calendar.date(bySettingHour: 17, minute: 0, second: 0, of: day) ?? day
        if calendar.isDateInToday(day), start < Date() {
            if calendar.component(.hour, from: Date()) >= 20 {
                let tomorrow = calendar.date(byAdding: .day, value: 1, to: day) ?? day
                start = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow
            } else {
                start = calendar.dateInterval(of: .hour, for: Date())?.end ?? Date()
            }
        }
        var values: [NativeEditableSlot] = []
        if let plan {
            if let span = plan.span,
               let first = NativePlanSchedule.date(span.startDate, hour: span.startHour, calendar: calendar),
               let last = NativePlanSchedule.date(span.endDate, hour: span.endHour, calendar: calendar) {
                values = [.init(start: first, end: last)]
            } else {
                values = plan.windows.compactMap { window in
                    guard let first = NativePlanSchedule.date(window.targetDate, hour: window.startHour, calendar: calendar),
                          let last = NativePlanSchedule.date(window.targetDate, hour: window.endHour, calendar: calendar) else { return nil }
                    return .init(start: first, end: last)
                }
            }
        }
        _slots = State(initialValue: values.isEmpty ? [.init(start: start, end: start.addingTimeInterval(3600))] : values)
        _weekdays = State(initialValue: Set(plan?.routine?.weekdays ?? [calendar.component(.weekday, from: start) - 1]))
        _repeats = State(initialValue: plan?.routine != nil)
    }

    private var zone: TimeZone { place.timezone.flatMap(TimeZone.init(identifier:)) ?? .current }
    private var calendar: Calendar { var value = Calendar(identifier: .gregorian); value.timeZone = zone; return value }

    var body: some View {
        NavigationStack {
            Form {
                Section("What are you planning?") {
                    TextField("Walk, soccer practice, camping…", text: $title)
                        .accessibilityIdentifier("plan.title")
                }
                Section("Place") {
                    Button { findingPlace = true } label: {
                        HStack { Label(place.displayName, systemImage: "mappin.and.ellipse"); Spacer(); Image(systemName: "chevron.right") }
                    }
                    Text("Times in \(zone.identifier)").font(.caption).foregroundStyle(.secondary)
                }
                Section("When") {
                    ForEach($slots) { $slot in
                        DatePicker("Starts", selection: $slot.start)
                        DatePicker("Ends", selection: $slot.end)
                    }
                    if slots.count == 1 {
                        Toggle("Repeat weekly", isOn: $repeats)
                        if repeats {
                            ForEach(0..<7, id: \.self) { index in
                                Toggle(calendar.weekdaySymbols[index], isOn: Binding(
                                    get: { weekdays.contains(index) },
                                    set: { if $0 { weekdays.insert(index) } else { weekdays.remove(index) } }))
                            }
                        }
                    } else {
                        Text("This plan has \(slots.count) separate windows. Each is kept when you save.").font(.caption)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                Section {
                    Button("Review weather") { prepareReview() }
                        .font(.headline).frame(maxWidth: .infinity)
                        .accessibilityIdentifier("plan.review")
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } footer: {
                    Text("You’ll review the schedule and forecast before saving. No notification settings are changed.")
                }
            }
            .environment(\.timeZone, zone)
            .environment(\.locale, Locale(identifier: context.uses24HourClock ? "en_GB" : "en_US"))
            .navigationTitle(request.existing == nil ? "New plan" : "Edit plan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } } }
            .sheet(isPresented: $findingPlace) {
                NativePlanPlacePicker(places: context.places) { selected in
                    // Keep wall-clock choices when changing the plan place.
                    let oldCalendar = calendar
                    var newCalendar = oldCalendar
                    newCalendar.timeZone = selected.timezone.flatMap(TimeZone.init(identifier:)) ?? zone
                    slots = slots.map { slot in
                        .init(start: newCalendar.date(from: oldCalendar.dateComponents([.year, .month, .day, .hour, .minute], from: slot.start)) ?? slot.start,
                              end: newCalendar.date(from: oldCalendar.dateComponents([.year, .month, .day, .hour, .minute], from: slot.end)) ?? slot.end)
                    }
                    place = selected; findingPlace = false
                }
            }
            .sheet(item: $reviewing) { plan in
                NativePlanReview(plan: plan, original: request.existing, context: context) { saved in
                    reviewing = nil
                    onSaved(saved)
                }
            }
        }
    }

    private func prepareReview() {
        do {
            guard !repeats || !weekdays.isEmpty else { throw NativePlanWriteError.invalid("Choose at least one day for the routine.") }
            guard let first = slots.first else { return }
            var plan = try NativePlanSchedule.make(title: title, place: place, start: first.start, end: first.end,
                weekdays: repeats ? Array(weekdays) : [], existing: request.existing)
            if slots.count > 1 {
                let parts = try slots.map { try NativePlanSchedule.make(title: title, place: place, start: $0.start, end: $0.end) }
                guard parts.allSatisfy({ $0.span == nil }) else { throw NativePlanWriteError.invalid("Each separate window must fit within one local day.") }
                let windows = parts.enumerated().map { index, part in
                    NativeAgendaWindow(id: "window-\(index)", targetDate: part.targetDate, startHour: part.startHour, endHour: part.endHour, label: "Plan window")
                }
                plan = NativeAgendaPlan(id: plan.id, title: plan.title, label: plan.label, original: plan.original, answer: "",
                    place: plan.place, targetDate: plan.targetDate, startHour: plan.startHour, endHour: plan.endHour,
                    windows: windows, scheduleType: .discrete, span: nil, routine: nil, scheduleID: plan.scheduleID,
                    createdAtMilliseconds: plan.createdAtMilliseconds, updatedAtMilliseconds: plan.updatedAtMilliseconds)
                try NativePlanSchedule.validate(plan)
            }
            error = nil; reviewing = plan
        } catch { self.error = error.localizedDescription }
    }
}

struct NativePlanPlacePicker: View {
    let places: [NativePreviewPlace]
    let onSelect: (NativeAgendaPlace) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [NativeManagedPlace] = []
    @State private var error: String?
    @State private var loading = false
    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    Section("Your places") {
                        ForEach(places) { place in Button(place.name) { onSelect(.init(preview: place)) } }
                    }
                } else {
                    if loading { ProgressView("Finding places…") }
                    if let error { Text(error).foregroundStyle(.secondary) }
                    ForEach(results) { place in
                        Button([place.name, place.admin1, place.country].filter { !$0.isEmpty }.joined(separator: ", ")) {
                            onSelect(.init(preview: place.previewPlace))
                        }
                    }
                    if !loading && results.isEmpty && error == nil { Text("No places found. Include a state or country.") }
                }
            }
            .searchable(text: $query, prompt: "City, state or country")
            .navigationTitle("Plan place")
            .toolbar { Button("Cancel") { dismiss() } }
            .task(id: query) {
                results = []; error = nil
                guard query.count >= 2 else { loading = false; return }
                loading = true
                do {
                    try await Task.sleep(for: .milliseconds(300))
                    let found = try await NativePlaceLookupService().search(query: query)
                    try Task.checkCancellation()
                    results = found; loading = false
                } catch is CancellationError { }
                catch { if !Task.isCancelled { self.error = error.localizedDescription; loading = false } }
            }
        }
    }
}

private struct NativePlanReview: View {
    let plan: NativeAgendaPlan
    let original: NativeAgendaPlan?
    let context: NativePreviewContext
    let onSaved: (NativeAgendaPlan) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?
    @State private var saved = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(plan.title).font(.title.bold())
                    Label(plan.place.displayName, systemImage: "mappin")
                    Text(NativePlanLabels.schedule(NativePlanSchedule.item(plan), clock24: context.uses24HourClock)).font(.headline)
                    NativeOwnedPlanWeather(plan: plan, context: context)
                    if let error { Text(error).foregroundStyle(.red) }
                    Button(original == nil ? "Save plan" : "Save changes") {
                        do {
                            try NativePlanLibrary.shared.save(plan, replacing: original)
                            saved = true; onSaved(plan)
                        } catch { self.error = error.localizedDescription }
                    }.buttonStyle(.borderedProminent).controlSize(.large).disabled(saved)
                        .accessibilityIdentifier("plan.save")
                    Text("Saved locally. No notifications are enabled by saving.").font(.footnote).foregroundStyle(.secondary)
                }.padding(20)
            }
            .navigationTitle("Review plan").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Back") { dismiss() } }
        }
    }
}

private struct NativeOwnedPlanDetail: View {
    let plan: NativeAgendaPlan
    let context: NativePreviewContext
    @ObservedObject var library: NativePlanLibrary
    let onEdit: () -> Void
    let onDeleted: () -> Void
    let onHourly: (NativeAgendaItem) -> Void
    @State private var deleting = false
    @State private var error: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text(plan.place.displayName).font(.title3)
                Text(NativePlanLabels.schedule(NativePlanSchedule.item(plan), clock24: context.uses24HourClock)).font(.headline)
                if let routine = plan.routine {
                    Text("Every " + routine.weekdays.map { Calendar.current.weekdaySymbols[$0] }.joined(separator: ", ")).foregroundStyle(.secondary)
                }
                NativeOwnedPlanWeather(plan: plan, context: context)
                Button("See hourly forecast", systemImage: "clock") { onHourly(NativePlanSchedule.item(plan)) }
                    .buttonStyle(.bordered)
                if library.archive.importedIDs.values.contains(plan.id) {
                    Text("Brought over as a native copy. Earlier notification watches are unchanged and still refer to the earlier plan.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                NativePlanNotificationControls(plan: plan, plans: library.plans, metric: context.metric)
                if let error { Text(error).foregroundStyle(.red) }
                Button("Delete plan", role: .destructive) { deleting = true }
            }.padding(20)
        }
        .navigationTitle(plan.title).navigationBarTitleDisplayMode(.inline)
        .toolbar { Button("Edit", action: onEdit).accessibilityIdentifier("plan.edit") }
        .confirmationDialog("Delete this plan?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Delete plan", role: .destructive) {
                do { try library.delete(plan); onDeleted() } catch { self.error = error.localizedDescription }
            }
        } message: { Text("This removes the native saved plan. It does not change earlier notification watches.") }
    }
}

struct NativeOwnedPlanWeather: View {
    let context: NativePreviewContext
    @StateObject private var model: NativePlanEvidenceModel
    init(plan: NativeAgendaPlan, context: NativePreviewContext) {
        self.context = context
        _model = StateObject(wrappedValue: NativePlanEvidenceModel(item: NativePlanSchedule.item(plan), metric: context.metric))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let evidence = model.evidence {
                Text(NativePlanWeatherRead.headline(evidence: evidence, forecast: model.forecast))
                    .font(.title2.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                if model.errorMessage != nil {
                    Label {
                        Text("Last available forecast · updated \(evidence.source.forecastGeneratedAt.formatted(date: .abbreviated, time: .shortened)) · refresh unavailable")
                    } icon: {
                        Image(systemName: "wifi.exclamationmark")
                    }
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("nearcast.native.plan.saved-forecast")
                }
                if let rain = evidence.rain?.probability {
                    Text("Peak rain chance \(Int(rain.rounded()))%" + (evidence.gust.map { " · Gusts \(Int($0.value.rounded())) \($0.unit)" } ?? ""))
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                DisclosureGroup("Weather details & sources") {
                    NativePlanEvidenceCard(evidence: evidence, now: Date(), uses24HourClock: context.uses24HourClock,
                        isRefreshing: model.isLoading, refreshError: model.errorMessage)
                }
            } else if model.isLoading {
                ProgressView("Checking this place and time…")
            } else {
                Text(model.errorMessage ?? "The forecast doesn’t reach this plan yet. You can save it now and check closer to the date.")
                    .foregroundStyle(.secondary)
                Button("Check again") { model.load(force: true) }
            }
        }.task { model.load() }.onDisappear { model.cancel() }
    }
}

enum NativePlanLabels {
    static func schedule(_ item: NativeAgendaItem, clock24: Bool) -> String {
        guard let calendar = try? NativePlanSchedule.calendar(item.place),
              let start = NativePlanSchedule.date(item.startDate, hour: item.startHour, calendar: calendar),
              let end = NativePlanSchedule.date(item.endDate, hour: item.endHour, calendar: calendar) else { return item.label }
        let formatter = DateFormatter()
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = clock24 ? "EEE, MMM d · HH:mm" : "EEE, MMM d · h:mm a"
        let first = formatter.string(from: start)
        if calendar.isDate(start, inSameDayAs: end) { formatter.dateFormat = clock24 ? "HH:mm" : "h:mm a" }
        return first + "–" + formatter.string(from: end)
    }
}
