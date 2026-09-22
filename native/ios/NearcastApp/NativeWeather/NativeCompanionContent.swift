import Foundation

/// Disposable companion display derived only from native schedules and
/// coordinate-bound native evidence. It does not enable a plan watch.
enum NativeCompanionContent {
    static func applying(to original: NearcastWidgetSnapshot, items: [NativeAgendaItem]?,
                         forecast: NativeWeatherForecast?, previewPlace: NativePreviewPlace,
                         essentials: NativeWeatherEssentials?, now: Date) -> NearcastWidgetSnapshot {
        var snapshot = original
        clearPlan(&snapshot)
        let candidates = (items ?? []).compactMap { item -> (NativeAgendaItem, NativePlanEvidenceWindow)? in
            guard let window = NativePlanEvidenceWindow(item: item), window.endsAt > now else { return nil }
            return (item, window)
        }.sorted {
            let leftActive = $0.1.startsAt <= now, rightActive = $1.1.startsAt <= now
            if leftActive != rightActive { return leftActive }
            if $0.1.startsAt != $1.1.startsAt { return $0.1.startsAt < $1.1.startsAt }
            return $0.0.id < $1.0.id
        }
        if let (item, window) = candidates.first {
            snapshot.planId = item.planID
            snapshot.planTitle = item.title
            snapshot.planPlace = item.place.displayName
            snapshot.planAvailable = true
            snapshot.planStartAt = window.startsAt.timeIntervalSince1970
            snapshot.planEndAt = window.endsAt.timeIntervalSince1970
            snapshot.planLabel = window.startsAt <= now ? "In progress" : "Upcoming plan"
            snapshot.planTone = "neutral"
            snapshot.planDetail = "Open this plan for its place’s forecast."
            // A schedule read is not a newly generated weather verdict.
            snapshot.planSavedAt = 0
            if matches(item.place, previewPlace), let forecast,
               let evidence = NativePlanEvidence.make(item: item, forecast: forecast, essentials: essentials, now: now) {
                snapshot.planSavedAt = evidence.source.forecastGeneratedAt.timeIntervalSince1970
                if !evidence.source.isForecastFresh {
                    snapshot.planDetail = "Saved forecast — refresh before you go."
                } else if evidence.coverage != .complete {
                    snapshot.planDetail = evidence.coverage == .partial
                        ? "Only part of this plan has a forecast."
                        : "The forecast doesn’t reach this plan yet."
                } else if case .active = evidence.officialAlerts {
                    snapshot.planDetail = "An official alert overlaps this plan."
                    snapshot.planTone = "caution"
                    snapshot.planRisk = "alert"
                } else {
                    // The generic headline includes retained alert records.
                    // Never promote an unverified retained record to a current
                    // warning merely because this compact surface lacks room.
                    let forecastOnly = NativePlanEvidence.make(item: item, forecast: forecast, essentials: nil, now: now)!
                    snapshot.planDetail = NativePlanWeatherRead.headline(evidence: forecastOnly, forecast: forecast)
                    let hours = forecast.hours.filter { $0.date >= window.startsAt.addingTimeInterval(-3599) && $0.date < window.endsAt }
                    if hours.contains(where: { $0.thunderPossible || NativeWeatherCondition.isThunder($0.weatherCode) }) {
                        snapshot.planRisk = "storm"
                        snapshot.planTone = "caution"
                    } else if (evidence.rain?.probability ?? -1) >= 30 {
                        snapshot.planRisk = "rain"
                        snapshot.planTone = "caution"
                    } else if let gust = evidence.gust, gust.value >= (forecast.metric ? 48 : 30) {
                        snapshot.planRisk = "wind"
                        snapshot.planTone = "caution"
                    }
                }
            }
        }
        applyAlerts(to: &snapshot, essentials: essentials, place: previewPlace, now: now)
        return snapshot
    }

    static func clearPlan(_ snapshot: inout NearcastWidgetSnapshot) {
        snapshot.planTitle = nil; snapshot.planLabel = nil; snapshot.planDetail = nil
        snapshot.planPlace = nil; snapshot.planTone = nil; snapshot.planSavedAt = nil
        snapshot.planId = nil; snapshot.planAvailable = false; snapshot.planRisk = nil
        snapshot.planStartAt = nil; snapshot.planEndAt = nil
        snapshot.watchStatus = nil; snapshot.watchDetail = nil; snapshot.watchTone = nil
    }

    private static func matches(_ place: NativeAgendaPlace, _ preview: NativePreviewPlace) -> Bool {
        place.id == preview.id && place.latitude == preview.latitude && place.longitude == preview.longitude
    }

    private static func applyAlerts(to snapshot: inout NearcastWidgetSnapshot, essentials: NativeWeatherEssentials?,
                                    place: NativePreviewPlace, now: Date) {
        guard let essentials,
              abs(essentials.latitude - place.latitude) <= 0.000_001,
              abs(essentials.longitude - place.longitude) <= 0.000_001 else {
            snapshot = snapshot.expiringOfficialAlert(at: now.timeIntervalSince1970)
            return
        }
        let state = essentials.alerts
        guard state.isFresh(now: now), let checkedAt = state.checkedAt else {
            // Missing, stale and unsupported are not a successful all-clear.
            // Existing alert expiry remains the hard display boundary.
            snapshot = snapshot.expiringOfficialAlert(at: now.timeIntervalSince1970)
            snapshot.alertStateReady = false
            return
        }
        guard checkedAt.timeIntervalSince1970 >= (snapshot.alertSavedAt ?? 0) else { return }
        let active = state.activeAlerts(at: now).sorted {
            if $0.priority != $1.priority { return $0.priority > $1.priority }
            return $0.id < $1.id
        }
        snapshot.clearOfficialAlert(checkedAt: checkedAt.timeIntervalSince1970)
        snapshot.alertLocation = NearcastCompanionLocation(latitude: place.latitude,
            longitude: place.longitude, resolvedAt: checkedAt.timeIntervalSince1970)
        guard let alert = active.first else { return }
        snapshot.alertId = alert.id
        snapshot.alertTitle = alert.event
        snapshot.alertSeverity = alert.severity
        snapshot.alertStartsAt = alert.startAt.timeIntervalSince1970
        snapshot.alertExpiresAt = min(alert.endAt, alert.expiresAt).timeIntervalSince1970
        snapshot.alertImpact = alert.headline
        snapshot.alertSource = NativeAlertState.source
        snapshot.alertUrgency = alert.urgency
        snapshot.alertCount = active.count
    }
}
