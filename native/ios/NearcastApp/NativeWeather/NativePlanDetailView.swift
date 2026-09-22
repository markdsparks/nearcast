import SwiftUI

/// A deliberately read-only detail for one saved weather plan.
///
/// Native Agenda is currently a verified projection of legacy-owned plans.
/// This screen makes that boundary legible: the answer saved with the plan is
/// preserved as history, while the weather read is evaluated separately from
/// current native data. Edit, watch, and notification controls deliberately
/// hand off to their existing owner rather than creating a second source of
/// truth here. Native Plans route focus intentionally uses
/// `NativeOwnedPlanDetail` for a local copy instead; an earlier-plan route
/// must never cause this projection to imply that a notification watch moved.
struct NativePlanDetailView: View {
    let plan: NativeAgendaPlan
    let item: NativeAgendaItem
    @StateObject private var evidenceModel: NativePlanEvidenceModel
    let uses24HourClock: Bool
    let onOpenHourly: () -> Void
    let onEdit: () -> Void
    let onManageWatch: () -> Void
    let onManageNotifications: () -> Void
    let onOpenAllPlans: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var now = Date()

    init(
        plan: NativeAgendaPlan,
        item: NativeAgendaItem,
        metric: Bool,
        uses24HourClock: Bool,
        onOpenHourly: @escaping () -> Void,
        onEdit: @escaping () -> Void,
        onManageWatch: @escaping () -> Void,
        onManageNotifications: @escaping () -> Void,
        onOpenAllPlans: @escaping () -> Void
    ) {
        self.plan = plan
        self.item = item
        _evidenceModel = StateObject(wrappedValue: NativePlanEvidenceModel(item: item, metric: metric))
        self.uses24HourClock = uses24HourClock
        self.onOpenHourly = onOpenHourly
        self.onEdit = onEdit
        self.onManageWatch = onManageWatch
        self.onManageNotifications = onManageNotifications
        self.onOpenAllPlans = onOpenAllPlans
    }

    /// Test-only / preview injection. Production callers should use the
    /// native-owned initializer above so a detail's load and cancellation
    /// lifetime exactly matches its presentation lifetime.
    init(
        plan: NativeAgendaPlan,
        item: NativeAgendaItem,
        evidenceModel: NativePlanEvidenceModel,
        uses24HourClock: Bool,
        onOpenHourly: @escaping () -> Void,
        onEdit: @escaping () -> Void,
        onManageWatch: @escaping () -> Void,
        onManageNotifications: @escaping () -> Void,
        onOpenAllPlans: @escaping () -> Void
    ) {
        self.plan = plan
        self.item = item
        _evidenceModel = StateObject(wrappedValue: evidenceModel)
        self.uses24HourClock = uses24HourClock
        self.onOpenHourly = onOpenHourly
        self.onEdit = onEdit
        self.onManageWatch = onManageWatch
        self.onManageNotifications = onManageNotifications
        self.onOpenAllPlans = onOpenAllPlans
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                planHeader
                scheduleCard
                savedAnswerCard
                currentWeatherSection
                hourlyAction
                managementSection
            }
            .frame(maxWidth: 680, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
        }
        .navigationTitle("Plan details")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            evidenceModel.load()
        }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { now = $0 }
        .onDisappear { evidenceModel.cancel() }
    }

    private var planHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: planIcon)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.tint)
                    .frame(width: 40, height: 40)
                    .background(Color.accentColor.opacity(colorScheme == .dark ? 0.22 : 0.12), in: Circle())
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 4) {
                    Text(plan.title)
                        .font(.title2.weight(.bold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(placeLabel)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Text(scheduleTitle)
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(plan.title), \(placeLabel), \(scheduleTitle)")
    }

    private var scheduleCard: some View {
        NativePlanDetailPanel {
            Label("Scheduled time", systemImage: "calendar.badge.clock")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(scheduleDetail)
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)
            if verifiedWindow == nil {
                Text("Nearcast could not verify this exact local time. Review the schedule in existing Plans before relying on it.")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let timeZoneName {
                Text("Times in \(timeZoneName)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("Time zone could not be verified for this saved plan.")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// A saved plan answer is useful context, but it is never passed off as a
    /// live verdict. In particular, it could have been authored days ago for a
    /// routine or multi-day trip.
    private var savedAnswerCard: some View {
        NativePlanDetailPanel {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label("Saved plan answer", systemImage: "bookmark")
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: 8)
                Text(savedStatus)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            if savedAnswer.isEmpty {
                Text("No saved answer is available for this plan.")
                    .font(.body)
                    .foregroundStyle(.secondary)
            } else {
                Text(savedAnswer)
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text("This is the answer saved with the plan. Check the current weather read below before relying on it.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var currentWeatherSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Current weather read")
                .font(.title3.weight(.bold))
                .accessibilityAddTraits(.isHeader)

            if let evidence = evidenceModel.evidence {
                NativePlanEvidenceCard(
                    evidence: evidence,
                    now: now,
                    uses24HourClock: uses24HourClock,
                    isRefreshing: evidenceModel.isLoading,
                    refreshError: evidenceModel.errorMessage
                )
            } else if evidenceModel.isLoading {
                loadingWeatherCard
            } else {
                unavailableWeatherCard
            }
        }
    }

    private var loadingWeatherCard: some View {
        NativePlanDetailPanel {
            HStack(alignment: .top, spacing: 12) {
                ProgressView().controlSize(.small).padding(.top, 2)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Checking weather for this time")
                        .font(.headline)
                    Text("Nearcast is loading a current forecast for \(placeLabel).")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var unavailableWeatherCard: some View {
        NativePlanDetailPanel(tint: .orange) {
            Label("Current weather could not be verified", systemImage: "exclamationmark.triangle")
                .font(.headline)
                .foregroundStyle(.orange)
            Text(evidenceModel.errorMessage ?? "Nearcast does not have enough current weather data for this plan window yet.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text("The saved answer above may be out of date. Open the hourly forecast for the available weather data.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .contain)
    }

    private var hourlyAction: some View {
        Button(action: onOpenHourly) {
            HStack(spacing: 12) {
                Image(systemName: "clock")
                    .font(.title3)
                    .foregroundStyle(.tint)
                    .frame(width: 28)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Open hourly forecast")
                        .font(.headline)
                    Text("See the forecast around this plan time")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
            .padding(.horizontal, 16)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 19, style: .continuous)
                    .strokeBorder(Color.accentColor.opacity(colorScheme == .dark ? 0.38 : 0.25), lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
        }
        .buttonStyle(NativePlanDetailActionButtonStyle())
        .accessibilityHint("Open hourly weather near this plan")
    }

    private var managementSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Manage plan")
                .font(.title3.weight(.bold))
                .accessibilityAddTraits(.isHeader)

            NativePlanDetailPanel {
                compatibilityRow(
                    title: "Edit plan",
                    detail: "Change the place, schedule, or plan details in existing Plans.",
                    symbol: "pencil",
                    action: onEdit
                )
                Divider().padding(.leading, 42)
                compatibilityRow(
                    title: "Watch this plan",
                    detail: "Review the weather watch for this plan in existing Plans.",
                    symbol: "eye",
                    action: onManageWatch
                )
                Divider().padding(.leading, 42)
                compatibilityRow(
                    title: "Notifications",
                    detail: "Review notification choices in existing Plans.",
                    symbol: "bell",
                    action: onManageNotifications
                )
            }

            Button("Open all plans", action: onOpenAllPlans)
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.borderless)
                .accessibilityHint("Open the existing Plans experience")
        }
    }

    private func compatibilityRow(
        title: String,
        detail: String,
        symbol: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: symbol)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.tint)
                    .frame(width: 28)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.body.weight(.semibold))
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.up.right.square")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(NativePlanDetailActionButtonStyle())
        .accessibilityHint("Continue in existing Plans")
    }

    private var placeLabel: String {
        let place = item.place
        let secondary = [place.admin1, place.country]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
        return secondary.map { "\(place.displayName), \($0)" } ?? place.displayName
    }

    private var planIcon: String {
        switch item.kind {
        case .continuousSpan: return "calendar.badge.clock"
        case .weeklyRoutine: return "arrow.triangle.2.circlepath"
        case .scheduledWindow: return "calendar"
        }
    }

    private var scheduleTitle: String {
        switch item.kind {
        case .continuousSpan: return "Continuous plan"
        case .weeklyRoutine: return "Weekly routine"
        case .scheduledWindow: return "Scheduled plan"
        }
    }

    private var savedAnswer: String {
        plan.answer.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var savedStatus: String {
        let seconds = max(0, now.timeIntervalSince1970 - Double(plan.updatedAtMilliseconds) / 1_000)
        if seconds < 90 { return "saved just now" }
        if seconds < 3_600 { return "saved \(Int(seconds / 60))m ago" }
        if seconds < 86_400 { return "saved \(Int(seconds / 3_600))h ago" }
        return "saved \(Int(seconds / 86_400))d ago"
    }

    private var verifiedWindow: NativePlanEvidenceWindow? {
        evidenceModel.evidence?.window ?? NativePlanEvidenceWindow(item: item)
    }

    private var timeZone: TimeZone? {
        (verifiedWindow?.timezoneID ?? item.place.timezone).flatMap(TimeZone.init(identifier:))
    }

    private var timeZoneName: String? {
        guard let timeZone else { return nil }
        return timeZone.localizedName(for: .shortGeneric, locale: .autoupdatingCurrent) ?? timeZone.identifier
    }

    private var scheduleDetail: String {
        let calendar = localCalendar
        if let window = verifiedWindow {
            let start = window.startsAt
            let end = window.endsAt
            let timeRange = "\(time(start, calendar: calendar))–\(time(end, calendar: calendar))"
            switch item.kind {
            case .weeklyRoutine:
                return "Weekly · \(shortDate(start, calendar: calendar)) · \(timeRange)"
            case .continuousSpan:
                return "\(dateTime(start, calendar: calendar)) – \(dateTime(end, calendar: calendar))"
            case .scheduledWindow:
                if calendar.isDate(start, inSameDayAs: end) {
                    return "\(shortDate(start, calendar: calendar)) · \(timeRange)"
                }
                return "\(dateTime(start, calendar: calendar)) – \(dateTime(end, calendar: calendar))"
            }
        }
        guard let start = date(for: item.startDate, calendar: calendar),
              let end = date(for: item.endDate, calendar: calendar) else {
            return item.kind == .weeklyRoutine ? "Weekly schedule" : "Scheduled time unavailable"
        }
        let starts = dateTime(start, hour: item.startHour, calendar: calendar)
        let ends = dateTime(end, hour: item.endHour, calendar: calendar)
        if item.kind == .weeklyRoutine {
            return "Weekly · \(time(start, hour: item.startHour, calendar: calendar))–\(time(end, hour: item.endHour, calendar: calendar))"
        }
        if item.startDate == item.endDate {
            return "\(shortDate(start, calendar: calendar)) · \(time(start, hour: item.startHour, calendar: calendar))–\(time(end, hour: item.endHour, calendar: calendar))"
        }
        return "\(starts) – \(ends)"
    }

    private var localCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = .autoupdatingCurrent
        calendar.timeZone = timeZone ?? .current
        return calendar
    }

    private func date(for civilDate: String, calendar: Calendar) -> Date? {
        let parts = civilDate.split(separator: "-")
        guard parts.count == 3,
              let year = Int(parts[0]),
              let month = Int(parts[1]),
              let day = Int(parts[2]) else { return nil }
        var components = DateComponents()
        components.calendar = calendar
        components.timeZone = calendar.timeZone
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        return calendar.date(from: components)
    }

    private func dateTime(_ date: Date, calendar: Calendar) -> String {
        "\(shortDate(date, calendar: calendar)), \(time(date, calendar: calendar))"
    }

    private func dateTime(_ date: Date, hour: Double, calendar: Calendar) -> String {
        "\(shortDate(date, calendar: calendar)), \(time(date, hour: hour, calendar: calendar))"
    }

    private func time(_ date: Date, hour: Double, calendar: Calendar) -> String {
        let minutes = max(0, Int((hour * 60).rounded()))
        let value = calendar.date(byAdding: .minute, value: minutes, to: calendar.startOfDay(for: date)) ?? date
        return time(value, calendar: calendar)
    }

    private func time(_ date: Date, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.locale = uses24HourClock ? Locale(identifier: "en_GB") : .autoupdatingCurrent
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate(uses24HourClock ? "HHmm" : "jmm")
        return formatter.string(from: date)
    }

    private func shortDate(_ date: Date, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMM d")
        return formatter.string(from: date)
    }
}

/// The evidence card is intentionally separate from the saved answer. Its
/// complete rendering is kept in this file so that agenda-detail polish does
/// not add any persistence or ownership behavior to the model layer.
struct NativePlanEvidenceCard: View {
    let evidence: NativePlanEvidence
    let now: Date
    let uses24HourClock: Bool
    let isRefreshing: Bool
    let refreshError: String?

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        NativePlanDetailPanel(tint: statusTint) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: statusSymbol)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(statusTint)
                    .frame(width: 24)
                    .padding(.top, 1)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(statusTitle)
                        .font(.headline)
                    Text(statusDetail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                if isRefreshing {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Updating weather")
                }
            }

            if hasWeatherFacts {
                Divider().padding(.vertical, 2)
                VStack(spacing: 11) {
                    if let condition = evidence.condition {
                        fact(
                            title: "Conditions",
                            value: condition.label,
                            detail: "Forecast near \(time(condition.at))",
                            symbol: condition.symbolName
                        )
                    }
                    if let rain = evidence.rain {
                        fact(
                            title: "Precipitation",
                            value: rainValue(rain),
                            detail: rainDetail(rain),
                            symbol: "drop.fill"
                        )
                    }
                    if let gust = evidence.gust {
                        fact(
                            title: "Peak gust",
                            value: gustValue(gust),
                            detail: "Forecast near \(time(gust.at))",
                            symbol: "wind"
                        )
                    }
                    if let uv = evidence.uv {
                        fact(
                            title: "Peak UV",
                            value: uvValue(uv),
                            detail: "Forecast near \(time(uv.at))",
                            symbol: "sun.max"
                        )
                    }
                }
            }

            Divider().padding(.vertical, 2)
            alertsRead

            if let refreshError, !refreshError.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Label(refreshError, systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }

            sourceDisclosure
        }
        .accessibilityElement(children: .combine)
    }

    private var hasWeatherFacts: Bool {
        evidence.condition != nil || evidence.rain != nil || evidence.gust != nil || evidence.uv != nil
    }

    private var forecastIsFresh: Bool {
        let age = now.timeIntervalSince(evidence.source.forecastGeneratedAt)
        return age >= -60 && age <= 6 * 60 * 60
    }

    private var statusTitle: String {
        switch evidence.coverage {
        case .complete:
            return forecastIsFresh ? "Forecast covers this plan" : "Saved forecast covers this plan"
        case .partial:
            return "Forecast covers part of this plan"
        case .unavailable:
            return "Forecast is unavailable for this plan time"
        }
    }

    private var statusDetail: String {
        switch evidence.coverage {
        case .complete:
            return forecastIsFresh
                ? "Forecast samples span the scheduled window."
                : "The saved forecast spans the scheduled window, but it is no longer current."
        case .partial:
            return "Nearcast has weather data for only part of the scheduled window. Missing time is not an all-clear."
        case .unavailable:
            return "Nearcast could not match forecast samples to this exact scheduled window."
        }
    }

    private var statusSymbol: String {
        switch evidence.coverage {
        case .complete: return forecastIsFresh ? "checkmark.circle.fill" : "clock.arrow.circlepath"
        case .partial: return "exclamationmark.circle.fill"
        case .unavailable: return "exclamationmark.triangle.fill"
        }
    }

    private var statusTint: Color {
        switch evidence.coverage {
        case .complete: return forecastIsFresh ? .green : .orange
        case .partial, .unavailable: return .orange
        }
    }

    @ViewBuilder
    private var alertsRead: some View {
        switch evidence.officialAlerts {
        case .clear(let checkedAt):
            fact(
                title: "Official alerts",
                value: "No active alert",
                detail: "Checked \(relativeTime(checkedAt)) for this plan window",
                symbol: "checkmark.shield"
            )
        case .active(let alerts, let checkedAt):
            VStack(alignment: .leading, spacing: 8) {
                fact(
                    title: "Official alerts",
                    value: alerts.count == 1 ? "1 active alert" : "\(alerts.count) active alerts",
                    detail: "Checked \(relativeTime(checkedAt)) for this plan window",
                    symbol: "exclamationmark.triangle.fill",
                    tint: .orange
                )
                ForEach(alerts.prefix(2)) { alert in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(alert.event)
                            .font(.subheadline.weight(.semibold))
                        Text(alert.headline)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.leading, 36)
                }
            }
        case .unavailable(let message, let retainedAlerts):
            VStack(alignment: .leading, spacing: 6) {
                fact(
                    title: "Official alerts",
                    value: "Could not verify now",
                    detail: message ?? "Official alerts could not be checked for this plan place.",
                    symbol: "exclamationmark.triangle.fill",
                    tint: .orange
                )
                if !retainedAlerts.isEmpty {
                    Text("Previously returned: \(retainedAlerts.map(\.event).prefix(2).joined(separator: ", "))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.leading, 36)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        case .unsupported(let message):
            fact(
                title: "Official alerts",
                value: "Coverage unavailable",
                detail: message ?? "Official alert coverage is not available for this plan place.",
                symbol: "exclamationmark.shield",
                tint: Color.secondary
            )
        }
    }

    private var sourceDisclosure: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(forecastIsFresh ? "Forecast source" : "Forecast source · update aging")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text("Forecast updated \(relativeTime(evidence.source.forecastGeneratedAt)) · evaluated \(relativeTime(evidence.source.evaluatedAt))")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 2)
    }

    private func fact(title: String, value: String, detail: String, symbol: String, tint: Color = .accentColor) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)
                .frame(width: 24)
                .padding(.top, 1)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func rainValue(_ rain: NativePlanRainEvidence) -> String {
        if let probability = rain.probability {
            return "\(Int(probability.rounded()))% chance · \(rain.label)"
        }
        return rain.label
    }

    private func rainDetail(_ rain: NativePlanRainEvidence) -> String {
        if rain.probability == nil {
            return "Forecast near \(time(rain.at))"
        }
        return "Highest available chance near \(time(rain.at))"
    }

    private func gustValue(_ gust: NativePlanGustEvidence) -> String {
        "\(Int(gust.value.rounded())) \(gust.unit)"
    }

    private func uvValue(_ uv: NativePlanUVEvidence) -> String {
        "UV \(Int(uv.index.rounded()))"
    }

    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.locale = .autoupdatingCurrent
        value.timeZone = TimeZone(identifier: evidence.window.timezoneID) ?? .current
        return value
    }

    private func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = uses24HourClock ? Locale(identifier: "en_GB") : .autoupdatingCurrent
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate(uses24HourClock ? "HHmm" : "jmm")
        return formatter.string(from: date)
    }

    private func relativeTime(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

private struct NativePlanDetailPanel<Content: View>: View {
    let tint: Color?
    @ViewBuilder let content: Content

    init(tint: Color? = nil, @ViewBuilder content: () -> Content) {
        self.tint = tint
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder((tint ?? .primary).opacity(tint == nil ? 0.10 : 0.46), lineWidth: 1)
        }
    }
}

private struct NativePlanDetailActionButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.92 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.988 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
