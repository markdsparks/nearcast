import SwiftUI
import Charts

/// One calm directory, permanently available below the forecast and from the
/// toolbar. No independent notification or saved-record behavior lives here.
struct NativeWeatherEssentialsSection: View {
    @ObservedObject var model: NativeWeatherPreviewModel
    let day: Date
    let now: Date
    let onOpen: (NativeWeatherDetailKind) -> Void

    var body: some View {
        if let forecast = model.forecast {
            let p = NativeWeatherDetailPresentation(forecast: forecast, day: day, now: now, uses24HourClock: model.context.uses24HourClock)
            VStack(alignment: .leading, spacing: 16) {
                Text("Weather details").font(.title3.weight(.bold)).accessibilityAddTraits(.isHeader)
                VStack(spacing: 0) {
                    detailRow(.air, value: airValue(today: p.isToday), note: p.isToday ? "Current estimate · US AQI" : "Current conditions only")
                    Divider()
                    detailRow(.sun, value: sunValue(p), note: "\(p.dayLabel) · local times")
                    Divider()
                    ForEach([NativeWeatherDetailKind.wind, .uv, .humidity, .visibility, .precipitation], id: \.self) { kind in
                        detailRow(kind, value: p.headline(kind), note: p.headlineLabel(kind))
                        Divider()
                    }
                    detailRow(.alerts, value: alertValue(p), note: "Official bulletins · selected place")
                }
                .padding(.horizontal, 16)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
            }
        }
    }

    private func detailRow(_ kind: NativeWeatherDetailKind, value: String, note: String) -> some View {
        Button { onOpen(kind) } label: {
            HStack(alignment: .center, spacing: 13) {
                Image(systemName: kind.symbol).font(.title3).frame(width: 26).foregroundStyle(.tint).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(kind.title).font(.subheadline.weight(.semibold))
                    Text(value).font(.headline).fixedSize(horizontal: false, vertical: true)
                    Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Open \(kind.title.lowercased()) details")
    }
    private func airValue(today: Bool) -> String {
        guard today else { return "Not forecast for this day" }
        guard let air = model.essentials?.airQuality else { return model.isLoadingEssentials ? "Checking…" : "Unavailable" }
        guard let snapshot = air.current(at: now), let value = snapshot.usAQI else {
            return air.status == .stale ? "Update unavailable" : "No current estimate"
        }
        return "\(Int(value.rounded())) · \(snapshot.band?.label ?? "US AQI")"
    }
    private func sunValue(_ p: NativeWeatherDetailPresentation) -> String {
        guard let rise = p.dayReading?.sunrise, let set = p.dayReading?.sunset, set > rise else { return "Explore daylight" }
        return "\(p.clock(rise)) sunrise · \(p.clock(set)) sunset"
    }
    private func alertValue(_ p: NativeWeatherDetailPresentation) -> String {
        guard let state = model.essentials?.alerts else { return model.isLoadingEssentials ? "Checking…" : "Not checked" }
        if state.status == .unsupported { return "Coverage unavailable here" }
        guard state.isFresh(now: now) else { return "Update unavailable" }
        let count = state.relevantAlerts(on: day, calendar: p.forecast.calendar, now: now).count
        return count == 0 ? "None currently issued for this day" : "\(count) \(count == 1 ? "alert" : "alerts") for this day"
    }
}

/// Prominence is reserved for relevant, fresh information, never stale AQI or
/// an empty failed alert request presented as an all-clear.
struct NativeWeatherEssentialNotices: View {
    @ObservedObject var model: NativeWeatherPreviewModel
    let day: Date
    let now: Date
    let onOpen: (NativeWeatherDetailKind) -> Void

    var body: some View {
        if let forecast = model.forecast, let essentials = model.essentials {
            let alerts = essentials.alerts.relevantAlerts(on: day, calendar: forecast.calendar, now: now)
            if let first = alerts.first {
                notice(.alerts, title: first.event,
                    detail: essentials.alerts.isFresh(now: now)
                        ? (alerts.count > 1 ? "\(alerts.count) official alerts · View details" : "Official alert · View details")
                        : "Bulletin available · Updates not fully verified", color: .orange)
            } else if essentials.alerts.status != .unsupported && !essentials.alerts.isFresh(now: now) {
                Button { onOpen(.alerts) } label: {
                    Label("Official alerts couldn’t update", systemImage: "exclamationmark.triangle")
                        .font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            if forecast.calendar.isDate(day, inSameDayAs: now),
               let air = essentials.airQuality.current(at: now), let aqi = air.usAQI, let band = air.band, band.rank >= 2 {
                notice(.air, title: "Air quality · \(band.label)", detail: "US AQI \(Int(aqi.rounded())) · Current estimate", color: .orange)
            }
        }
    }
    private func notice(_ kind: NativeWeatherDetailKind, title: String, detail: String, color: Color) -> some View {
        Button { onOpen(kind) } label: {
            HStack(spacing: 12) {
                Image(systemName: kind.symbol).font(.title2).foregroundStyle(color).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.headline)
                    Text(detail).font(.subheadline).foregroundStyle(.secondary)
                }.fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.bold))
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(16)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
            .overlay { RoundedRectangle(cornerRadius: 20).strokeBorder(color.opacity(0.5), lineWidth: 1) }
        }
        .buttonStyle(.plain)
    }
}

struct NativeWeatherDetailsSheet: View {
    @ObservedObject var model: NativeWeatherPreviewModel
    let kind: NativeWeatherDetailKind
    let day: Date
    @Environment(\.dismiss) private var dismiss
    @State private var now = Date()

    var body: some View {
        NavigationStack {
            content(kind)
                .navigationTitle(kind.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
                .navigationDestination(for: NativeWeatherDetailKind.self) { destination in
                    content(destination).navigationTitle(destination.title).navigationBarTitleDisplayMode(.inline)
                }
        }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { now = $0 }
    }

    @ViewBuilder private func content(_ destination: NativeWeatherDetailKind) -> some View {
        if let forecast = model.forecast {
            let p = NativeWeatherDetailPresentation(forecast: forecast, day: day, now: now, uses24HourClock: model.context.uses24HourClock)
            switch destination {
            case .sun:
                NativeSunDaylightView(forecast: forecast, day: day, placeName: model.selectedPlace.name, uses24HourClock: model.context.uses24HourClock)
            case .overview:
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        context(p)
                        ForEach(NativeWeatherDetailKind.allCases.filter { $0 != .overview }) { entry in
                            NavigationLink(value: entry) {
                                HStack {
                                    Label(entry.title, systemImage: entry.symbol).font(.headline)
                                    Spacer(minLength: 12)
                                    Image(systemName: "chevron.right").font(.caption)
                                }.frame(minHeight: 48).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            Divider()
                        }
                    }.padding(22)
                }
            case .air: airQuality(p)
            case .alerts: alerts(p)
            default: metricDetail(destination, p: p)
            }
        } else {
            ContentUnavailableView("Weather unavailable", systemImage: "cloud", description: Text("Close this detail and refresh the forecast."))
        }
    }

    private func context(_ p: NativeWeatherDetailPresentation) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.selectedPlace.name).font(.headline)
            Text("\(p.dayLabel) · Times at this location").font(.subheadline).foregroundStyle(.secondary)
        }.fixedSize(horizontal: false, vertical: true)
    }

    private func metricDetail(_ kind: NativeWeatherDetailKind, p: NativeWeatherDetailPresentation) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                context(p)
                VStack(alignment: .leading, spacing: 6) {
                    Text(p.headline(kind)).font(.system(.largeTitle, design: .rounded, weight: .bold))
                    Text(p.headlineLabel(kind)).font(.subheadline).foregroundStyle(.secondary)
                }
                NativeDetailTrend(presentation: p, kind: kind)
                VStack(spacing: 16) {
                    ForEach(p.facts(kind)) { fact in
                        NativeDetailFact(label: fact.label, value: fact.value)
                        Divider()
                    }
                }
                Text(p.explanation(kind)).font(.body).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if kind == .uv {
                    NavigationLink(value: NativeWeatherDetailKind.sun) { Label("Explore sun & daylight", systemImage: "sun.horizon") }.font(.headline)
                    Link("About UV and clouds · EPA", destination: URL(string: "https://www.epa.gov/sunsafety/calculating-uv-index-0")!).font(.subheadline)
                }
                Text("Forecast updated \(p.timestamp(p.forecast.generatedAt))").font(.caption).foregroundStyle(.secondary)
            }.padding(22)
        }
    }

    private func airQuality(_ p: NativeWeatherDetailPresentation) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                context(p)
                if !p.isToday {
                    Label("No air-quality forecast for this day", systemImage: "calendar.badge.exclamationmark").font(.title2.weight(.bold))
                    Text("This native view offers the current air-quality estimate only. Choose Today to check it; today’s reading is not a forecast for \(p.dayLabel).")
                } else if let state = model.essentials?.airQuality, let snapshot = state.snapshot, let value = snapshot.usAQI {
                    let fresh = state.current(at: now) != nil
                    VStack(alignment: .leading, spacing: 8) {
                        Text(fresh ? "Current estimate" : "Last available estimate").font(.subheadline).foregroundStyle(.secondary)
                        Text("\(Int(value.rounded()))").font(.system(size: 64, weight: .semibold, design: .rounded)).monospacedDigit()
                        Text(snapshot.band?.label ?? "US AQI").font(.title2.weight(.bold))
                        Text("US Air Quality Index · \(p.timestamp(snapshot.sampleAt))").font(.subheadline).foregroundStyle(.secondary)
                    }
                    if !fresh {
                        Label("Couldn’t verify current air quality. This saved estimate may no longer describe conditions.", systemImage: "clock.arrow.circlepath")
                            .font(.body).foregroundStyle(.secondary)
                    }
                    aqScale(value: value)
                    if fresh, let advice = snapshot.band?.advice { Text(advice).font(.headline) }
                    NativeDetailFact(label: "Fine particles · PM2.5", value: particles(snapshot.pm25))
                    NativeDetailFact(label: "Coarse particles · PM10", value: particles(snapshot.pm10))
                    Text("Open-Meteo / CAMS provides a modeled estimate for this area, not a measurement at your exact address. Local conditions can differ.")
                        .font(.body).foregroundStyle(.secondary)
                    retryEssentials
                } else {
                    Label(model.isLoadingEssentials ? "Checking air quality…" : "Current air quality unavailable", systemImage: "aqi.medium").font(.title2.weight(.bold))
                    Text(model.essentials?.airQuality.message ?? "An air-quality estimate hasn’t loaded for this place yet.").foregroundStyle(.secondary)
                    retryEssentials
                }
                Link("About the AQI scale · AirNow", destination: URL(string: "https://www.airnow.gov/aqi/aqi-basics/")!)
                Link("Air-quality data · Open-Meteo", destination: URL(string: "https://open-meteo.com/en/docs/air-quality-api")!).font(.subheadline)
            }.padding(22)
        }
    }

    private func aqScale(value: Double) -> some View {
        let bands: [(String, String, Color, Double, Double)] = [
            ("0–50", "Good", .green, 0, 50), ("51–100", "Moderate", .yellow, 50, 100),
            ("101–150", "Unhealthy for sensitive groups", .orange, 100, 150),
            ("151–200", "Unhealthy", .red, 150, 200), ("201–300", "Very unhealthy", .purple, 200, 300),
            ("301+", "Hazardous", Color(red: 0.55, green: 0.15, blue: 0.3), 300, .infinity)
        ]
        return VStack(alignment: .leading, spacing: 12) {
            Text("US AQI scale").font(.headline)
            ForEach(bands.indices, id: \.self) { index in
                let band = bands[index]
                let selected = value.rounded() <= band.4 && (index == 0 || value.rounded() > band.3)
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Circle().fill(band.2).frame(width: 9, height: 9).accessibilityHidden(true)
                    Text(band.0).font(.subheadline.monospacedDigit()).frame(minWidth: 62, alignment: .leading)
                    Text(band.1).font(.subheadline.weight(selected ? .bold : .regular))
                    if selected { Image(systemName: "checkmark").font(.caption.weight(.bold)) }
                }.accessibilityElement(children: .combine).accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }

    private func alerts(_ p: NativeWeatherDetailPresentation) -> some View {
        let state = model.essentials?.alerts
        let relevant = state?.relevantAlerts(on: day, calendar: p.forecast.calendar, now: now) ?? []
        return ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                context(p)
                if state?.status == .unsupported {
                    Label("Official alerts unavailable here", systemImage: "globe").font(.title2.weight(.bold))
                    Text(state?.message ?? "This native preview currently supports National Weather Service alerts in covered US locations. Use your local weather authority for official warnings.")
                } else if state?.isFresh(now: now) != true {
                    Label(model.isLoadingEssentials ? "Checking official alerts…" : "Couldn’t verify official alerts", systemImage: "exclamationmark.triangle").font(.title2.weight(.bold))
                    Text("Missing or outdated alert information does not mean there are no hazards.\(relevant.isEmpty ? "" : " Saved bulletins are shown below.")").foregroundStyle(.secondary)
                } else if relevant.isEmpty {
                    Text("No currently issued alerts overlap \(p.isToday ? "the rest of today" : p.dayLabel).")
                        .font(.title2.weight(.bold))
                    Text("Alerts can be issued later. This is not an all-clear for future weather.").foregroundStyle(.secondary)
                }
                ForEach(relevant) { alert in
                    if relevant.count == 1 {
                        NativeOfficialAlertDetail(alert: alert, presentation: p, checkedAt: state?.checkedAt,
                            isFresh: state?.isFresh(now: now) == true).bulletin
                    } else {
                        NavigationLink {
                            NativeOfficialAlertDetail(alert: alert, presentation: p, checkedAt: state?.checkedAt, isFresh: state?.isFresh(now: now) == true)
                        } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Label(alert.event, systemImage: "exclamationmark.triangle.fill").font(.headline)
                                Text(alert.headline).font(.subheadline).foregroundStyle(.secondary)
                                if let end = alert.eventEndsAt {
                                    Text("Event through \(p.timestamp(end))").font(.caption).foregroundStyle(.secondary)
                                } else {
                                    Text("Event end not specified").font(.caption).foregroundStyle(.secondary)
                                }
                                Text("Read official instructions ›").font(.subheadline.weight(.semibold))
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                            .background(.quaternary, in: RoundedRectangle(cornerRadius: 18))
                            .fixedSize(horizontal: false, vertical: true)
                        }.buttonStyle(.plain)
                    }
                }
                if let checked = state?.checkedAt { Text("Last checked \(p.timestamp(checked))").font(.caption).foregroundStyle(.secondary) }
                Text("Source: National Weather Service. Only bulletins relevant to this location and day are shown.").font(.caption).foregroundStyle(.secondary)
                retryEssentials
                Link("National Weather Service", destination: URL(string: "https://www.weather.gov/")!)
            }.padding(22)
        }
    }
    private var retryEssentials: some View {
        Button { model.refreshEssentials(force: true) } label: {
            HStack { if model.isLoadingEssentials { ProgressView() }; Text(model.isLoadingEssentials ? "Updating…" : "Check again") }
                .frame(minHeight: 44)
        }.disabled(model.isLoadingEssentials)
    }
    private func particles(_ value: Double?) -> String { value.map { String(format: "%.1f µg/m³", $0) } ?? "Unavailable" }
}

private struct NativeDetailFact: View {
    let label: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.subheadline).foregroundStyle(.secondary)
            Text(value).font(.headline).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
    }
}

private struct NativeDetailTrend: View {
    let presentation: NativeWeatherDetailPresentation
    let kind: NativeWeatherDetailKind
    private struct Sample: Identifiable { let date: Date; let value: Double; let segment: Int; var id: Date { date } }
    private var samples: [Sample] {
        guard let path = kind.keyPath else { return [] }
        var segment = 0
        var previous: Date?
        return presentation.hours.compactMap { point in
            guard let value = point[keyPath: path] else { segment += 1; previous = nil; return nil }
            if let previous, point.date.timeIntervalSince(previous) > 3700 { segment += 1 }
            previous = point.date
            return Sample(date: point.date, value: kind == .visibility ? value / (presentation.forecast.metric ? 1000 : 1609.344) : value, segment: segment)
        }
    }
    var body: some View {
        if !samples.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("\(presentation.dayLabel) · hourly forecast").font(.headline)
                Chart(samples) { sample in
                    LineMark(x: .value("Local time", sample.date), y: .value(kind.title, sample.value), series: .value("Available segment", sample.segment))
                        .lineStyle(StrokeStyle(lineWidth: 2.5)).foregroundStyle(.tint)
                    PointMark(x: .value("Local time", sample.date), y: .value(kind.title, sample.value)).symbolSize(10).foregroundStyle(.tint)
                        .accessibilityLabel(presentation.clock(sample.date))
                        .accessibilityValue(presentation.formatted(kind == .visibility ? sample.value * (presentation.forecast.metric ? 1000 : 1609.344) : sample.value, kind: kind))
                }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { value in
                        AxisGridLine()
                        AxisValueLabel { if let date = value.as(Date.self) { Text(presentation.clock(date)).font(.caption2) } }
                    }
                }
                .frame(height: 170)
                .accessibilityLabel("\(kind.title), hourly forecast for \(presentation.dayLabel)")
            }
        }
    }
}

private struct NativeOfficialAlertDetail: View {
    let alert: NativeOfficialAlert
    let presentation: NativeWeatherDetailPresentation
    let checkedAt: Date?
    let isFresh: Bool
    var body: some View {
        ScrollView {
            bulletin.padding(22)
        }
        .navigationTitle("Alert details").navigationBarTitleDisplayMode(.inline)
    }
    var bulletin: some View {
        VStack(alignment: .leading, spacing: 22) {
                Label(alert.event, systemImage: "exclamationmark.triangle.fill").font(.title2.weight(.bold))
                if !isFresh { Text("Bulletin updates could not be fully verified.").font(.headline).foregroundStyle(.orange) }
                Text(alert.headline).font(.headline)
                NativeDetailFact(label: "Event starts", value: presentation.timestamp(alert.startAt))
                NativeDetailFact(label: "Expected event end", value: alert.eventEndsAt.map(presentation.timestamp) ?? "Not specified")
                NativeDetailFact(label: "Bulletin valid until", value: presentation.timestamp(alert.expiresAt))
                if !alert.instruction.isEmpty {
                    Text("What to do").font(.title3.weight(.bold)).accessibilityAddTraits(.isHeader)
                    Text(alert.instruction).textSelection(.enabled)
                }
                Text("Official bulletin").font(.title3.weight(.bold)).accessibilityAddTraits(.isHeader)
                Text(alert.description).textSelection(.enabled)
                if !alert.areaDescription.isEmpty { NativeDetailFact(label: "Area described by the bulletin", value: alert.areaDescription) }
                if let source = alert.sourceURL { Link("Read at the official source", destination: source).font(.headline) }
                if let checkedAt { Text("National Weather Service · Checked \(presentation.timestamp(checkedAt))").font(.caption).foregroundStyle(.secondary) }
        }.fixedSize(horizontal: false, vertical: true)
    }
}
