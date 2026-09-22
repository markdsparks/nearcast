import SwiftUI

/// The native, read-only presentation of Nearcast's verified plan export.
///
/// This view deliberately owns no plan data, persistence, verdicts, watches,
/// or notification selections. Its caller supplies a verified `NativeAgenda`
/// and explicitly decides where opening, compatibility, and creation actions
/// go. In particular, an unavailable projection never renders as an empty
/// agenda: "no verified data" and "verified with no plans" are different
/// states for a family relying on Nearcast.
struct NativeAgendaView: View {
    let agenda: NativeAgenda?
    let availability: NativeAgendaAvailability
    let currentDate: Date
    let onOpenPlan: (NativeAgendaItem) -> Void
    let onOpenCompatibility: () -> Void
    let onCreatePlan: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(
        agenda: NativeAgenda?,
        availability: NativeAgendaAvailability,
        currentDate: Date = Date(),
        onOpenPlan: @escaping (NativeAgendaItem) -> Void,
        onOpenCompatibility: @escaping () -> Void,
        onCreatePlan: @escaping () -> Void
    ) {
        self.agenda = agenda
        self.availability = availability
        self.currentDate = currentDate
        self.onOpenPlan = onOpenPlan
        self.onOpenCompatibility = onOpenCompatibility
        self.onCreatePlan = onCreatePlan
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header

            switch contentState {
            case .agenda(let sections, let retained):
                if retained {
                    retainedNotice
                }
                if sections.isEmpty {
                    emptyAgenda(hasNoSavedPlans: agenda?.plans.isEmpty == true)
                } else {
                    ForEach(sections) { section in
                        sectionView(section)
                    }
                }
            case .unavailable:
                unavailable
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Upcoming")
                    .font(.title3.weight(.bold))
                    .accessibilityAddTraits(.isHeader)
                Text(headerSubtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button("All plans", action: onOpenCompatibility)
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.borderless)
                .accessibilityHint("Open the existing Plans experience")
        }
    }

    private var headerSubtitle: String {
        switch availability {
        case .ready(_, let isEmpty):
            return isEmpty ? "Your next seven days" : "The next seven days"
        case .retained:
            return "Last verified schedule"
        case .unavailable:
            return "Plans when they are ready"
        }
    }

    @ViewBuilder
    private func sectionView(_ section: NativeAgendaSection) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(section.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(section.kind == .inProgress ? Color.accentColor : Color.secondary)
                .accessibilityAddTraits(.isHeader)

            VStack(spacing: 0) {
                ForEach(Array(section.items.enumerated()), id: \.element.id) { index, item in
                    planRow(item)
                    if index < section.items.count - 1 {
                        Divider().padding(.leading, 54)
                    }
                }
            }
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(.primary.opacity(borderOpacity), lineWidth: 1)
            }
        }
    }

    private func planRow(_ item: NativeAgendaItem) -> some View {
        Button {
            onOpenPlan(item)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                agendaIcon(for: item)
                    .frame(width: 30, height: 30)
                    .foregroundStyle(iconTint(for: item))
                    .padding(.top, 1)

                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(placeLabel(for: item.place))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    Text(scheduleLabel(for: item))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(item.isInProgress ? Color.accentColor : .secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
                    .padding(.top, 8)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(NativeAgendaRowButtonStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel(for: item))
        .accessibilityHint("Open this plan")
    }

    private var retainedNotice: some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.title3)
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text("Showing the last verified agenda")
                    .font(.subheadline.weight(.semibold))
                Text("A newer plan update could not be verified here. Open existing Plans before changing anything.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.orange.opacity(0.42), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }

    private func emptyAgenda(hasNoSavedPlans: Bool) -> some View {
        let hasPlansWithoutVerifiedTimeZone = agenda?.plans.contains { plan in
            guard let identifier = plan.place.timezone else { return true }
            return TimeZone(identifier: identifier) == nil
        } == true
        let title = hasNoSavedPlans
            ? "No plans saved yet"
            : hasPlansWithoutVerifiedTimeZone
                ? "Some plans need a time zone"
                : "Nothing planned in the next seven days"
        let explanation: String
        if hasNoSavedPlans {
            explanation = "This is a verified empty agenda—not a missing update. Add a weather plan whenever timing matters."
        } else if hasPlansWithoutVerifiedTimeZone {
            explanation = "Nearcast could not safely place one or more saved plans in local time. Open existing Plans to review the full schedule."
        } else {
            explanation = "Nearcast has verified saved plans, but none belong in this seven-day view. Open existing Plans for the full schedule."
        }
        return VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: "calendar")
                .font(.headline)
            Text(explanation)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Button("Create a plan", action: onCreatePlan)
                    .buttonStyle(.borderedProminent)
                    .accessibilityHint("Start a weather-aware plan")
                if !hasNoSavedPlans {
                    Button("All plans", action: onOpenCompatibility)
                        .buttonStyle(.bordered)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(.primary.opacity(borderOpacity), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }

    private var unavailable: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Plans are not verified on this device", systemImage: "exclamationmark.triangle")
                .font(.headline)
                .foregroundStyle(.orange)
            Text("This does not mean there are no plans. Native Nearcast has not received a safe agenda snapshot yet.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Button("Open existing Plans", action: onOpenCompatibility)
                    .buttonStyle(.borderedProminent)
                Button("Create a plan", action: onCreatePlan)
                    .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(Color.orange.opacity(0.48), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }

    private var contentState: NativeAgendaContentState {
        switch availability {
        case .ready(_, let isEmpty):
            guard let agenda, agenda.plans.isEmpty == isEmpty else { return .unavailable }
            return .agenda(sections: groupedSections(for: agenda), retained: false)
        case .retained:
            guard let agenda else { return .unavailable }
            return .agenda(sections: groupedSections(for: agenda), retained: true)
        case .unavailable:
            return .unavailable
        }
    }

    private func groupedSections(for agenda: NativeAgenda) -> [NativeAgendaSection] {
        // NativeAgenda already derives each continuous span once. The ID set is
        // an additional presentation guard: no visual grouping can duplicate a
        // multi-day item if a future importer accidentally returns it twice.
        // The repository intentionally exposes every routine occurrence within
        // the horizon for other consumers; the Agenda editorially shows only
        // each routine's rolled-forward *next* occurrence.
        let items = agenda.items(from: currentDate, horizonDays: 7)
        var seen = Set<String>()
        var shownRoutinePlanIDs = Set<String>()
        let uniqueItems = items.filter { item in
            guard seen.insert(item.id).inserted else { return false }
            guard item.kind == .weeklyRoutine else { return true }
            return shownRoutinePlanIDs.insert(item.planID).inserted
        }

        var orderedKeys: [NativeAgendaSectionKey] = []
        var groups: [NativeAgendaSectionKey: [NativeAgendaItem]] = [:]
        for item in uniqueItems {
            let key = sectionKey(for: item)
            if groups[key] == nil { orderedKeys.append(key) }
            groups[key, default: []].append(item)
        }

        return orderedKeys.compactMap { key in
            guard let items = groups[key] else { return nil }
            return NativeAgendaSection(
                id: key.id,
                kind: key.kind,
                title: key.title,
                sortOrder: key.sortOrder,
                items: items
            )
        }
        .sorted {
            if $0.sortOrder != $1.sortOrder { return $0.sortOrder < $1.sortOrder }
            return $0.id < $1.id
        }
    }

    private func sectionKey(for item: NativeAgendaItem) -> NativeAgendaSectionKey {
        if item.isInProgress {
            return NativeAgendaSectionKey(kind: .inProgress, id: "in-progress", title: "In progress", sortOrder: -1)
        }

        let timeZone = timeZone(for: item)
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = timeZone
        guard let start = civilDate(item.startDate, in: calendar) else {
            // The repository validates civil dates. This conservative fallback
            // is only for a future model change; it remains a concrete date,
            // not an invented Today/empty bucket.
            return NativeAgendaSectionKey(kind: .date, id: "date-\(item.startDate)", title: item.startDate, sortOrder: 100)
        }

        let today = calendar.startOfDay(for: currentDate)
        let startOfItemDay = calendar.startOfDay(for: start)
        let offset = calendar.dateComponents([.day], from: today, to: startOfItemDay).day ?? 99
        switch offset {
        case 0:
            return NativeAgendaSectionKey(kind: .today, id: "today", title: "Today", sortOrder: 0)
        case 1:
            return NativeAgendaSectionKey(kind: .tomorrow, id: "tomorrow", title: "Tomorrow", sortOrder: 1)
        default:
            let title = weekdayDate(start, calendar: calendar)
            return NativeAgendaSectionKey(kind: .date, id: "date-\(item.startDate)", title: title, sortOrder: max(offset, 2))
        }
    }

    private func agendaIcon(for item: NativeAgendaItem) -> Image {
        switch item.kind {
        case .continuousSpan:
            return Image(systemName: "calendar.badge.clock")
        case .weeklyRoutine:
            return Image(systemName: "arrow.triangle.2.circlepath")
        case .scheduledWindow:
            return Image(systemName: "calendar")
        }
    }

    private func iconTint(for item: NativeAgendaItem) -> Color {
        if item.isInProgress { return .accentColor }
        switch item.kind {
        case .continuousSpan:
            return colorScheme == .dark ? Color(red: 0.83, green: 0.72, blue: 0.42) : Color(red: 0.55, green: 0.37, blue: 0.08)
        case .weeklyRoutine:
            return colorScheme == .dark ? Color(red: 0.60, green: 0.77, blue: 1) : Color(red: 0.16, green: 0.37, blue: 0.63)
        case .scheduledWindow:
            return .accentColor
        }
    }

    private func placeLabel(for place: NativeAgendaPlace) -> String {
        let region = [place.admin1, place.country]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
        if let region { return "\(place.displayName), \(region)" }
        return place.displayName
    }

    private func scheduleLabel(for item: NativeAgendaItem) -> String {
        let range = timeRange(for: item)
        switch item.kind {
        case .continuousSpan:
            return spanLabel(for: item)
        case .weeklyRoutine:
            return "Weekly routine · \(range)"
        case .scheduledWindow:
            return range
        }
    }

    private func spanLabel(for item: NativeAgendaItem) -> String {
        let calendar = calendar(for: item)
        guard let start = civilDate(item.startDate, in: calendar),
              let end = civilDate(item.endDate, in: calendar) else {
            return "Continuous plan"
        }
        let startText = dateTime(start, hour: item.startHour, calendar: calendar)
        let endText = dateTime(end, hour: item.endHour, calendar: calendar)
        return "\(startText) — \(endText)"
    }

    private func timeRange(for item: NativeAgendaItem) -> String {
        let calendar = calendar(for: item)
        guard let start = civilDate(item.startDate, in: calendar),
              let end = civilDate(item.endDate, in: calendar) else {
            return item.label
        }
        if item.startDate != item.endDate {
            return "\(dateTime(start, hour: item.startHour, calendar: calendar)) — \(dateTime(end, hour: item.endHour, calendar: calendar))"
        }
        let startText = time(start, hour: item.startHour, calendar: calendar)
        let endText = time(end, hour: item.endHour, calendar: calendar)
        return "\(startText)–\(endText)"
    }

    private func accessibilityLabel(for item: NativeAgendaItem) -> String {
        let status = item.isInProgress ? "In progress. " : ""
        return "\(status)\(item.title), \(placeLabel(for: item.place)), \(scheduleLabel(for: item))"
    }

    private var borderOpacity: Double {
        colorScheme == .dark ? 0.16 : 0.08
    }

    private func timeZone(for item: NativeAgendaItem) -> TimeZone {
        item.place.timezone.flatMap(TimeZone.init(identifier:)) ?? .current
    }

    private func calendar(for item: NativeAgendaItem) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = timeZone(for: item)
        return calendar
    }

    private func civilDate(_ value: String, in calendar: Calendar) -> Date? {
        let parts = value.split(separator: "-")
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

    private func dateTime(_ date: Date, hour: Double, calendar: Calendar) -> String {
        let time = time(date, hour: hour, calendar: calendar)
        return "\(shortDate(date, calendar: calendar)), \(time)"
    }

    private func time(_ date: Date, hour: Double, calendar: Calendar) -> String {
        let totalMinutes = max(0, Int((hour * 60).rounded()))
        let adjusted = calendar.date(byAdding: .minute, value: totalMinutes, to: calendar.startOfDay(for: date)) ?? date
        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.timeStyle = .short
        return formatter.string(from: adjusted)
    }

    private func weekdayDate(_ date: Date, calendar: Calendar) -> String {
        localizedDate(date, template: "EEEE, MMM d", calendar: calendar)
    }

    private func shortDate(_ date: Date, calendar: Calendar) -> String {
        localizedDate(date, template: "MMM d", calendar: calendar)
    }

    private func localizedDate(_ date: Date, template: String, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }
}

private enum NativeAgendaContentState {
    case agenda(sections: [NativeAgendaSection], retained: Bool)
    case unavailable
}

private enum NativeAgendaSectionKind: Hashable {
    case inProgress
    case today
    case tomorrow
    case date
}

private struct NativeAgendaSectionKey: Hashable {
    let kind: NativeAgendaSectionKind
    let id: String
    let title: String
    let sortOrder: Int

    // The presentation identity is intentionally the bucket identity. Two
    // family places can have different time zones yet belong to the same
    // local civil-date bucket; title and sort metadata must not split that
    // one visual group or create duplicate SwiftUI section IDs.
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

private struct NativeAgendaSection: Identifiable {
    let id: String
    let kind: NativeAgendaSectionKind
    let title: String
    let sortOrder: Int
    let items: [NativeAgendaItem]
}

/// The plain style is visually quiet but gives no pressed acknowledgment. A
/// dense schedule needs a small, immediate response so a working plan row
/// never feels like static text.
private struct NativeAgendaRowButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background {
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .fill(Color.accentColor.opacity(configuration.isPressed ? 0.12 : 0))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .strokeBorder(Color.accentColor.opacity(configuration.isPressed ? 0.38 : 0), lineWidth: 1)
            }
            .opacity(configuration.isPressed ? 0.94 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
