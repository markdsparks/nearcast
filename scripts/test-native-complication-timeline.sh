#!/bin/bash
set -euo pipefail

TIMELINE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TIMELINE_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-complication-timeline.XXXXXX")"
trap 'rm -rf "$TIMELINE_TEMP"' EXIT

# Compile the actual provider timeline, projection and entry-state functions.
# Only WidgetKit's protocol/value types are stubbed; no copied scheduling loop,
# network, simulator or personal App Group data is used.
node --input-type=module - "$TIMELINE_ROOT" "$TIMELINE_TEMP" <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root = process.argv[2], temp = process.argv[3];
const source = fs.readFileSync(`${root}/native/ios/NearcastWatchComplications/NearcastWatchComplications.swift`, 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = end === null ? source.length : source.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing production section ${start}`);
  return source.slice(a, b);
}
let timeline = section('private func complicationTimelineDates(', 'private func briefRelevance(');
// Mutation checks exercise the old behavior only in this temporary harness.
const mutation = process.env.NEARCAST_COMPLICATION_TIMELINE_MUTATION ?? '';
assert(['', 'coalesce-deadlines', 'omit-plan-deadlines'].includes(mutation), 'known timeline test mutation');
if (mutation === 'coalesce-deadlines') {
  const winner = 'return Array(Set(dates + deadlines)).sorted()';
  assert(timeline.includes(winner), 'exact deadline merge is wired');
  timeline = timeline.replace(winner, `return (dates + deadlines).sorted().reduce(into: [Date]()) { result, date in
    guard result.last.map({ date.timeIntervalSince($0) >= 60 }) ?? true else { return }
    result.append(date)
  }`);
} else if (mutation === 'omit-plan-deadlines') {
  assert(timeline.includes('if snapshot.hasPlan {'), 'plan deadlines are wired');
  timeline = timeline.replace('if snapshot.hasPlan {', 'if false {');
}
if (mutation) console.log(`TEST MUTATION (temporary harness only): ${mutation}`);
const program = String.raw`
import Foundation
private protocol TimelineEntry {}
private struct TimelineEntryRelevance {
    let score: Float
    let duration: TimeInterval
}
${section('private let planStaleAfter:', '\n\nprivate enum NearcastComplicationColor')}
${section('private enum WeatherDataState:', 'private struct NearcastComplicationProvider:')}
${section('private func makeEntry(', '/// Gives WidgetKit enough')}
${timeline}
${section('private func briefRelevance(', '@ViewBuilder\nprivate func unavailableState')}
${section('private func age(at date:', 'private func highLowText(')}
${section('private func conditionLabel(', null)}

private func verify(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        FileHandle.standardError.write(Data("FAIL  \(message)\n".utf8))
        exit(1)
    }
    print("PASS  \(message)")
}

@main
private enum TimelineTests {
    static let now = Date(timeIntervalSince1970: 1_800_000_000)
    static var timestamp: TimeInterval { now.timeIntervalSince1970 }
    static func date(_ offset: TimeInterval) -> Date { now.addingTimeInterval(offset) }
    static func row(_ offset: TimeInterval) -> NearcastWidgetHour {
        NearcastWidgetHour(offsetHours: offset.isFinite ? Int(offset / 3600) : 0, timeLabel: "Hour",
            temperature: 70, feelsLike: 70, rainChance: 0, wind: 5, windGust: 6,
            windDirection: 0, uv: 0, conditionCode: 0, isDay: true, startsAt: timestamp + offset)
    }
    static func fixture() -> NearcastWidgetSnapshot {
        var snapshot = NearcastWidgetSnapshot.fallback
        snapshot.isAvailable = true
        snapshot.savedAt = timestamp
        snapshot.weatherSavedAt = timestamp
        snapshot.placeName = "Public test place"
        snapshot.timeline = [row(0), row(3600), row(7200)]
        return snapshot
    }
    static func entry(_ snapshot: NearcastWidgetSnapshot, _ offset: TimeInterval) -> NearcastComplicationEntry {
        makeEntry(date: date(offset), snapshot: projectedSnapshot(snapshot, at: date(offset), relativeTo: now),
            weatherValidUntil: complicationWeatherValidUntil(snapshot))
    }
    static func contains(_ dates: [Date], _ offset: TimeInterval) -> Bool { dates.contains(date(offset)) }

    static func main() {
        var snapshot = fixture()
        snapshot.alertTitle = "Test warning"
        snapshot.alertId = "public-alert"
        snapshot.alertSavedAt = timestamp
        snapshot.alertStartsAt = timestamp + 3610
        snapshot.alertExpiresAt = timestamp + 3620
        snapshot.canonicalEventId = "public-event"
        snapshot.canonicalEventHeadline = "Rain later"
        snapshot.canonicalEventKind = "rain"
        snapshot.canonicalEventStartAt = timestamp + 3621
        snapshot.canonicalEventEndAt = timestamp + 3622
        snapshot.planAvailable = true
        snapshot.planTitle = "Public test plan"
        snapshot.planStartAt = timestamp + 3630
        snapshot.planEndAt = timestamp + 3650
        snapshot.planSavedAt = timestamp - 3600 + 40
        let dates = complicationTimelineDates(snapshot: snapshot, now: now)
        for offset: TimeInterval in [3600, 3610, 3620, 3621, 3622, 3630, 3640, 3650] {
            verify(contains(dates, offset), "actual provider preserves distinct deadline at +\(Int(offset)) seconds")
        }
        verify(Set(dates).count == dates.count && dates == dates.sorted(), "provider dates are unique and strictly ordered")
        verify(entry(snapshot, 3619).snapshot.alertId == "public-alert", "official alert survives until its exact expiry")
        verify(entry(snapshot, 3620).snapshot.alertId == nil, "official alert is removed exactly at expiry")
        verify(entry(snapshot, 3621).snapshot.canonicalEventId == "public-event", "forecast event survives until its exact end")
        verify(entry(snapshot, 3622).snapshot.canonicalEventId == nil, "forecast event is removed exactly at its end")
        let event = entry(snapshot, 3621).snapshot.companionStory(at: timestamp + 3621)!
        let before = nearcastCompactStoryCopy(event, at: timestamp + 3620, timeZoneIdentifier: "UTC")
        let active = nearcastCompactStoryCopy(event, at: timestamp + 3621, timeZoneIdentifier: "UTC")
        verify(before.timing != active.timing && active.timing?.hasPrefix("Until") == true,
            "exact event start advances the actual compact timing copy")
        verify(entry(snapshot, 3639).planState == .fresh, "plan evidence stays fresh before the two-hour boundary")
        verify(entry(snapshot, 3640).planState == .stale, "plan evidence becomes stale exactly at the two-hour boundary")
        verify(entry(snapshot, 3650).planState == .empty, "completed plan becomes empty at its exact end")
        var freshPlan = snapshot
        freshPlan.planSavedAt = timestamp
        verify(entry(freshPlan, 3649).planState == .fresh && entry(freshPlan, 3650).planState == .empty,
            "plan-end expiry independently clears a still-fresh verdict")

        var weather = fixture()
        weather.timeline = [row(-1790)] // This final row's interval ends at +1810.
        let weatherDates = complicationTimelineDates(snapshot: weather, now: now)
        verify(contains(weatherDates, 1800) && contains(weatherDates, 1810),
            "hard weather validity survives ten seconds after the ordinary safety entry")
        verify(entry(weather, 1809).weatherState == .fresh && entry(weather, 1810).weatherState == .stale,
            "actual weather entry becomes stale exactly at its hard validity boundary")
        weather.timeline = nil
        weather.weatherSavedAt = timestamp - 5390
        verify(contains(complicationTimelineDates(snapshot: weather, now: now), 1810),
            "timeline-free current weather retains its exact two-hour fallback expiry")

        var noExpiry = fixture()
        noExpiry.alertTitle = "Test warning"
        noExpiry.alertSavedAt = timestamp - 880 // 45-minute TTL ends at +1820.
        verify(contains(complicationTimelineDates(snapshot: noExpiry, now: now), 1820),
            "open-ended alert TTL survives near the safety entry")
        verify(entry(noExpiry, 1819).snapshot.alertTitle != nil && entry(noExpiry, 1820).snapshot.alertTitle == nil,
            "open-ended alert expires at its exact source-based TTL")

        var coincident = snapshot
        coincident.alertExpiresAt = timestamp + 3600
        coincident.canonicalEventStartAt = timestamp + 3600
        coincident.canonicalEventEndAt = timestamp + 3600
        coincident.planEndAt = timestamp + 3600
        let coincidentDates = complicationTimelineDates(snapshot: coincident, now: now)
        verify(coincidentDates.filter { $0 == date(3600) }.count == 1, "identical hard and ordinary dates deduplicate once")
        verify(entry(coincident, 3600).snapshot.alertTitle == nil && entry(coincident, 3600).planState == .empty,
            "a shared deadline applies every exact-boundary state transition")

        var bounded = fixture()
        bounded.timeline = (0...100).map { row(TimeInterval($0 * 3600)) }
        let boundedDates = complicationTimelineDates(snapshot: bounded, now: now)
        verify(contains(boundedDates, 24 * 3600) && !contains(boundedDates, 25 * 3600),
            "ordinary forecast projection retains its 24-hour horizon")
        verify(boundedDates.count <= 27, "hourly projection count stays bounded plus one terminal expiry")
        verify(contains(boundedDates, 101 * 3600), "hard forecast expiry survives beyond the ordinary projection horizon")
        bounded.alertTitle = "Long-lived test warning"
        bounded.alertExpiresAt = timestamp + 48 * 3600 + 20
        verify(contains(complicationTimelineDates(snapshot: bounded, now: now), 48 * 3600 + 20),
            "a long-lived official alert retains its terminal expiry beyond 24 hours")
        bounded.timeline = (0...500).map { row(TimeInterval($0 * 60)) }
        verify(complicationTimelineDates(snapshot: bounded, now: now).count <= 34,
            "dense or oversized forecast rows cannot create an unbounded timeline")
        bounded.timeline = [row(0), row(.infinity), row(.nan)]
        bounded.canonicalEventHeadline = "Test event"
        bounded.canonicalEventStartAt = .infinity
        bounded.canonicalEventEndAt = .infinity
        verify(complicationTimelineDates(snapshot: bounded, now: now).allSatisfy { $0.timeIntervalSince1970.isFinite },
            "invalid timestamps never enter the provider timeline")
        print("PASS  actual complication timeline deadlines and state transitions")
    }
}
`;
const shared = `${root}/native/ios/Shared`;
const sources = ['NearcastWidgetSnapshot.swift', 'NearcastForecastSemantics.swift', 'NearcastWatchVisualSignal.swift']
  .map(name => fs.readFileSync(`${shared}/${name}`, 'utf8')).join('\n') + '\n' + program;
const binary = `${temp}/complication-timeline-test`;
const compiled = spawnSync('xcrun', ['swiftc', '-O', '-parse-as-library', '-swift-version', '6',
  '-module-cache-path', `${temp}/modules`, '-', '-o', binary], {input: sources, encoding: 'utf8'});
process.stdout.write(compiled.stdout ?? ''); process.stderr.write(compiled.stderr ?? '');
assert.equal(compiled.status, 0, 'actual complication timeline compilation');
const run = spawnSync(binary, [], {encoding: 'utf8', timeout: 30000});
process.stdout.write(run.stdout ?? ''); process.stderr.write(run.stderr ?? '');
assert.equal(run.status, 0, 'actual complication timeline behavior');
NODE
