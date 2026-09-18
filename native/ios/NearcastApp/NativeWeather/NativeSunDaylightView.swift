import SwiftUI

/// Reusable native counterpart of the hourly Sun lens. Selection belongs to
/// this view; inspecting light never changes the forecast's selected hour.
struct NativeSunDaylightView: View {
    let forecast: NativeWeatherForecast
    let day: Date
    let placeName: String
    let uses24HourClock: Bool

    @Environment(\.colorScheme) private var colorScheme
    @State private var selection: Double?

    private var sun: NativeSunDaylight { NativeSunDaylight(forecast: forecast, day: day) }
    private var gold: Color {
        colorScheme == .dark ? Color(red: 1, green: 0.79, blue: 0.35) : Color(red: 0.65, green: 0.36, blue: 0.02)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
                let model = sun
                let selected = selection.map { model.date(at: $0) } ?? model.defaultDate(now: context.date)
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(placeName).font(.headline).fixedSize(horizontal: false, vertical: true)
                            Text(dayTitle(now: context.date)).font(.subheadline).foregroundStyle(.secondary)
                        }
                        if model.mode == .unavailable {
                            unavailable
                        } else {
                            readout(model, selected: selected, now: context.date)
                            sunTimeline(model, selected: selected, now: context.date)
                        }
                        timingRows(model)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("About this view").font(.headline)
                            Text("Times use this place’s local clock and your clock setting. The curve shows the daylight window, not the sun’s exact elevation. Clouds and terrain affect how bright it feels; there can still be light before sunrise and after sunset.")
                                .font(.subheadline).foregroundStyle(.secondary)
                            if model.mode != .unavailable {
                                Text("UV uses the available hourly forecast for the selected time. Moving the timeline does not create finer-resolution UV readings.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(20)
                    .frame(maxWidth: 700, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
        }
        .navigationTitle("Sun & daylight")
        .navigationBarTitleDisplayMode(.inline)
        .background(Color(uiColor: .systemGroupedBackground))
        .onChange(of: day) { _, _ in selection = nil }
        .onChange(of: forecast.timezoneID) { _, _ in selection = nil }
    }

    private func readout(_ model: NativeSunDaylight, selected: Date, now: Date) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(selection == nil && model.interval.contains(now) ? "Now" : model.clock(selected, uses24HourClock: uses24HourClock, includeZone: true))
                    .font(.title2.weight(.bold)).monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Button(model.interval.contains(now) ? "Now" : "Reset") { selection = nil }
                    .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                    .accessibilityLabel(model.interval.contains(now) ? "Reset sun timeline to now" : "Reset sun timeline to midday")
                    .disabled(selection == nil)
            }
            Text(status(model, at: selected)).font(.title3.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            if let detail = detail(model, at: selected) {
                Text(detail).font(.body).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(uvReadout(model, at: selected))
                .font(.subheadline).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .contain)
    }

    private func sunTimeline(_ model: NativeSunDaylight, selected: Date, now: Date) -> some View {
        VStack(spacing: 8) {
            GeometryReader { geometry in
                let inset: CGFloat = 14
                let width = max(1, geometry.size.width - inset * 2)
                let horizon: CGFloat = 128
                let amplitude: CGFloat = 89
                let x = inset + width * model.progress(at: selected)
                let y = horizon - amplitude * (model.height(at: selected) ?? 0)
                ZStack(alignment: .topLeading) {
                    Path { path in
                        path.move(to: CGPoint(x: inset, y: horizon))
                        path.addLine(to: CGPoint(x: width + inset, y: horizon))
                    }.stroke(Color.secondary.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [3, 4]))

                    curve(model, width: width, inset: inset, horizon: horizon, amplitude: amplitude, daylightOnly: false)
                        .stroke(Color.secondary.opacity(0.45), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    curve(model, width: width, inset: inset, horizon: horizon, amplitude: amplitude, daylightOnly: true)
                        .stroke(gold, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    if now >= model.interval.start && now < model.interval.end {
                        let nowX = inset + width * model.progress(at: now)
                        Path { path in
                            path.move(to: CGPoint(x: nowX, y: 15))
                            path.addLine(to: CGPoint(x: nowX, y: 184))
                        }.stroke(Color.secondary.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [2, 4]))
                    }
                    Path { path in
                        path.move(to: CGPoint(x: x, y: y))
                        path.addLine(to: CGPoint(x: x, y: 193))
                    }.stroke(gold.opacity(0.55), style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                    Circle().fill(gold.opacity(0.12)).frame(width: 44, height: 44).position(x: x, y: y)
                    Image(systemName: "sun.max.fill")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(model.isDaylight(at: selected) == true ? gold : Color.secondary)
                        .padding(4).background(Color(uiColor: .systemGroupedBackground), in: Circle())
                        .position(x: x, y: y)
                }
            }
            .frame(height: 200)
            .accessibilityHidden(true)

            Slider(value: Binding(get: { selection ?? model.progress(at: selected) }, set: { selection = $0 }), in: 0...1)
                .tint(gold)
                .frame(minHeight: 44)
                .accessibilityLabel("Inspect daylight by time")
                .accessibilityValue(accessibilityReadout(model, at: selected))
                .accessibilityAdjustableAction { direction in
                    let step = 15 * 60 / model.interval.duration
                    switch direction {
                    case .increment: selection = min(1, model.progress(at: selected) + step)
                    case .decrement: selection = max(0, model.progress(at: selected) - step)
                    @unknown default: break
                    }
                }
            HStack {
                Text(uses24HourClock ? "00:00" : "12 AM")
                Spacer()
                Text("Local time")
                Spacer()
                Text(uses24HourClock ? "23:59" : "11:59 PM")
            }.font(.caption).foregroundStyle(.secondary)
            Text("Move the slider to explore daylight and UV.")
                .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func curve(_ model: NativeSunDaylight, width: CGFloat, inset: CGFloat, horizon: CGFloat, amplitude: CGFloat, daylightOnly: Bool) -> Path {
        Path { path in
            let start = daylightOnly && model.mode == .normal ? model.sunrise! : model.interval.start
            let end = daylightOnly && model.mode == .normal ? model.sunset! : model.interval.end
            guard !daylightOnly || model.mode != .continuousNight else { return }
            for index in 0...120 {
                let date = start.addingTimeInterval(end.timeIntervalSince(start) * Double(index) / 120)
                let point = CGPoint(x: inset + width * model.progress(at: date), y: horizon - amplitude * (model.height(at: date) ?? 0))
                if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
            }
        }
    }

    private var unavailable: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Sun timing unavailable", systemImage: "sun.horizon").font(.title3.weight(.semibold))
            Text("This forecast doesn’t include enough sun timing for this day. Missing times don’t mean there is no daylight.")
                .foregroundStyle(.secondary)
        }
    }

    private func timingRows(_ model: NativeSunDaylight) -> some View {
        VStack(spacing: 0) {
            timingRow("Sunrise", symbol: "sunrise", value: model.sunrise.map { model.clock($0, uses24HourClock: uses24HourClock) } ?? noEventValue(model), date: model.mode == .normal ? model.sunrise : nil, model: model)
            Divider().padding(.vertical, 13)
            timingRow("Sunset", symbol: "sunset", value: model.sunset.map { model.clock($0, uses24HourClock: uses24HourClock) } ?? noEventValue(model), date: model.mode == .normal ? model.sunset : nil, model: model)
            Divider().padding(.vertical, 13)
            timingRow("Daylight", symbol: "sun.max", value: model.daylightDuration.map(NativeSunDaylight.duration) ?? "Unavailable", date: nil, model: model)
        }
        .padding(18)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22))
    }

    @ViewBuilder private func timingRow(_ title: String, symbol: String, value: String, date: Date?, model: NativeSunDaylight) -> some View {
        if let date {
            Button { selection = model.progress(at: date) } label: {
                timingLabel(title, symbol: symbol, value: value)
            }.buttonStyle(.plain)
                .accessibilityLabel("\(title), \(value)")
                .accessibilityHint("Show this time on the sun timeline")
        } else {
            timingLabel(title, symbol: symbol, value: value)
        }
    }

    private func timingLabel(_ title: String, symbol: String, value: String) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                Label(title, systemImage: symbol).foregroundStyle(.secondary)
                Spacer(minLength: 16)
                Text(value).fontWeight(.semibold).monospacedDigit()
            }
            VStack(alignment: .leading, spacing: 6) {
                Label(title, systemImage: symbol).foregroundStyle(.secondary)
                Text(value).fontWeight(.semibold).monospacedDigit()
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 44)
        .font(.body)
    }

    private func noEventValue(_ model: NativeSunDaylight) -> String {
        model.mode == .continuousDaylight || model.mode == .continuousNight ? "None this day" : "Unavailable"
    }

    private func uvReadout(_ model: NativeSunDaylight, at date: Date) -> String {
        guard let uv = model.uv(at: date) else { return "UV unavailable for this time" }
        return "Forecast UV \(uv.formatted(.number.precision(.fractionLength(0...1))))"
    }

    private func accessibilityReadout(_ model: NativeSunDaylight, at date: Date) -> String {
        "\(model.clock(date, uses24HourClock: uses24HourClock, includeZone: true)), \(status(model, at: date)), \(uvReadout(model, at: date))"
    }

    private func status(_ model: NativeSunDaylight, at date: Date) -> String {
        switch model.mode {
        case .continuousDaylight: return "Sun above the horizon all day"
        case .continuousNight: return "Sun below the horizon all day"
        case .unavailable: return "Sun timing unavailable"
        case .normal:
            if date < model.sunrise! { return "Before sunrise" }
            if date >= model.sunset! { return "After sunset" }
            return "\(NativeSunDaylight.duration(model.sunset!.timeIntervalSince(date))) until sunset"
        }
    }

    private func detail(_ model: NativeSunDaylight, at date: Date) -> String? {
        guard model.mode == .normal else { return nil }
        if date < model.sunrise! {
            return "Sunrise at \(model.clock(model.sunrise!, uses24HourClock: uses24HourClock)) · in \(NativeSunDaylight.duration(model.sunrise!.timeIntervalSince(date)))"
        }
        if date >= model.sunset! {
            if let next = model.nextSunrise {
                return "Next sunrise \(model.clock(next, uses24HourClock: uses24HourClock)) tomorrow"
            }
            return "Sunset was \(model.clock(model.sunset!, uses24HourClock: uses24HourClock))"
        }
        return "Sunset at \(model.clock(model.sunset!, uses24HourClock: uses24HourClock))"
    }

    private func dayTitle(now: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = forecast.timeZone
        formatter.dateFormat = "EEEE, MMM d"
        let title = forecast.calendar.isDate(day, inSameDayAs: now) ? "Today" : formatter.string(from: day)
        return "\(title) · Times at this location"
    }
}
