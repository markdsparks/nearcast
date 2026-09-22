#!/bin/bash
set -euo pipefail

# This is intentionally a source-level contract test.  The Day rhythm view
# imports SwiftUI Charts, which is not available to the small model-only Swift
# test harness.  These checks protect the interaction and rendering promises
# that must not regress while the chart's implementation evolves.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VIEW="$ROOT/native/ios/NearcastApp/NativeWeather/NativeDayRhythmView.swift"
PREVIEW="$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewView.swift"

fail() {
  printf 'FAIL  Day rhythm view contract: %s\n' "$1" >&2
  exit 1
}

require() {
  local pattern="$1"
  local file="$2"
  local message="$3"
  rg -q --fixed-strings "$pattern" "$file" || fail "$message"
}

# Extracting the body of a small Swift helper lets this source-level test
# verify that a value is not merely declared somewhere else in the view: it
# must be part of the selected readout's actual rendering path.  SwiftUI and
# Charts are intentionally outside this lightweight test harness.
function_body() {
  local signature="$1"
  awk -v signature="$signature" '
    index($0, signature) { capturing = 1 }
    capturing {
      print
      opening = gsub(/\{/, "{")
      closing = gsub(/\}/, "}")
      if (opening > 0) sawOpening = 1
      depth += opening - closing
      if (sawOpening && depth == 0) exit
    }
  ' "$VIEW"
}

require_text() {
  local pattern="$1"
  local text="$2"
  local message="$3"
  [[ "$text" == *"$pattern"* ]] || fail "$message"
}

# A chart tap or scrub is a local inspection, never a route-changing action.
if rg -q --fixed-strings 'onCommit' "$VIEW"; then
  fail 'the chart still exposes a parent navigation callback'
fi
if rg -q --fixed-strings 'commitSelection(' "$VIEW"; then
  fail 'the chart still has a separate commit path that can reintroduce navigation'
fi

DAY_RHYTHM_CALL="$(awk '/NativeDayRhythmView\(/, /metric: \$dayRhythmMetric/' "$PREVIEW")"
[[ -n "$DAY_RHYTHM_CALL" ]] || fail 'the native hourly screen no longer hosts Day rhythm'
if printf '%s\n' "$DAY_RHYTHM_CALL" | rg -q --fixed-strings 'onCommit:'; then
  fail 'the native hourly screen still hands Day rhythm a route-changing callback'
fi

require 'DragGesture(minimumDistance: 0' "$VIEW" \
  'a tap must be able to select an hour without requiring a drag'
require 'updateChartSelection(for: gesture, plotWidth: frame.width, proxy: proxy)' "$VIEW" \
  'finger movement must update the in-place selected hour'
require 'finishChartSelection(for: gesture, plotWidth: frame.width, proxy: proxy)' "$VIEW" \
  'touch completion must stay in the chart inspection path'
require 'updateLocalSelection(at: x, proxy: proxy)' "$VIEW" \
  'touch completion must preserve the in-place selected hour'
require 'Swipe up or down to inspect an hour. The selected value updates here without leaving the hourly forecast.' "$VIEW" \
  'VoiceOver must describe the chart as an in-place inspection control'
require 'if localSelection != nil { return "Viewing" }' "$VIEW" \
  'the header must visibly distinguish a finger-selected time from Now'

# The selected value is a compact inspection result, not simply the charted
# primary series.  The visual header must use the dedicated formatter so each
# lens can include its consequential companion fact without making the chip a
# second dense data table.
SELECTED_READOUT="$(awk '/private var selectedReadout: some View/,/^    private var selectionLabel/' "$VIEW")"
SELECTED_VALUE="$(function_body 'private func selectedValue(for sample: Sample) -> String')"
WIND_READOUT="$(function_body 'private func windReadout(for sample: Sample) -> String')"
RAIN_READOUT="$(function_body 'private func rainReadout(for sample: Sample) -> String')"

[[ -n "$SELECTED_VALUE" ]] || fail 'the selected-hour formatter is missing'
[[ -n "$WIND_READOUT" ]] || fail 'the selected wind formatter is missing'
[[ -n "$RAIN_READOUT" ]] || fail 'the selected rain formatter is missing'
require_text 'Text(selectedValue(for: sample))' "$SELECTED_READOUT" \
  'the visual selected-hour header must render the dedicated selected value'
require_text 'case .wind:' "$SELECTED_VALUE" \
  'the selected-hour formatter must route the Wind lens explicitly'
require_text 'windReadout(for: sample)' "$SELECTED_VALUE" \
  'the selected-hour formatter must use the Wind readout helper'
require_text 'case .rain:' "$SELECTED_VALUE" \
  'the selected-hour formatter must route the Rain lens explicitly'
require_text 'rainReadout(for: sample)' "$SELECTED_VALUE" \
  'the selected-hour formatter must use the Rain readout helper'

# Wind's charted series is sustained speed; the inspection result must also
# carry the gust value when it exists.  A generic "wind" label or a delta
# alone is insufficient because it obscures the actual gust forecast.
require_text 'sample.point.windGusts' "$WIND_READOUT" \
  'the Wind selected value must read the provider-supplied gust field'
require_text 'Gust' "$WIND_READOUT" \
  'the Wind selected value must visibly label gusts'

# Rain's charted series is chance, but planning needs the paired accumulated
# amount.  The amount must be sourced from the canonical hourly accumulation,
# be finite, and be nonnegative before it is shown.  This prevents a missing
# or malformed source value from becoming a confident-looking total.
require_text 'sample.value' "$RAIN_READOUT" \
  'the Rain selected value must retain the charted hourly precipitation chance'
require_text '% chance' "$RAIN_READOUT" \
  'the Rain selected value must visibly label the hourly precipitation chance'
require_text 'sample.point.precipitationMM' "$RAIN_READOUT" \
  'the Rain selected value must read the canonical hourly accumulation'
require_text 'amount.isFinite' "$RAIN_READOUT" \
  'the Rain selected value must reject nonfinite accumulation'
require_text 'amount >= 0' "$RAIN_READOUT" \
  'the Rain selected value must reject negative accumulation'
require_text 'Accum.' "$RAIN_READOUT" \
  'the Rain selected value must visibly label accumulation'

# Primary and comparison paths must have unique series identities.  Swift
# Charts otherwise bridges equal segment numbers into a misleading diagonal.
require 'series: .value("Plot series", "primary-\(metric.rawValue)-\(sample.segment)")' "$VIEW" \
  'primary samples need a metric-and-segment-specific series identity'
require 'series: .value("Plot series", "comparison-\(metric.rawValue)-\(sample.segment)")' "$VIEW" \
  'comparison samples need a metric-and-segment-specific series identity'

# Color is semantic, not decoration: exact values remain available in the
# readout while the trace changes with the selected weather dimension.
require 'private func semanticColor(for value: Double) -> Color' "$VIEW" \
  'the chart needs one explicit semantic color mapping'
require 'private func temperatureColor(_ temperature: Double) -> Color' "$VIEW" \
  'temperature needs a temperature-aware palette'
require 'private func precipitationColor(_ chance: Double) -> Color' "$VIEW" \
  'rain needs a probability-aware palette'
require 'private func windColor(_ speed: Double) -> Color' "$VIEW" \
  'wind needs a speed-aware palette'
require 'private func daylightColor(_ height: Double) -> Color' "$VIEW" \
  'sun needs a daylight-aware palette'
require 'color: semanticColor(for: sample.value)' "$VIEW" \
  'the plotted primary trace needs to use its semantic palette'
require '.foregroundStyle(semanticColor(for: sample.value))' "$VIEW" \
  'each plotted point needs to reflect its own weather value'

# Rain may use a restrained fill; the other lenses should remain readable as
# traces rather than a stack of generic translucent boxes.
AREA_MARKS="$(rg -c --fixed-strings 'AreaMark(' "$VIEW")"
[[ "$AREA_MARKS" == "1" ]] || fail 'only the rain lens should render an area fill'
require 'if metric == .rain {' "$VIEW" \
  'the area fill must be limited to precipitation'

# The selected moment needs a visual cursor, not a floating navigation affordance.
require 'RuleMark(x: .value("Selected hour", selected.date))' "$VIEW" \
  'a selected hour needs a visible vertical guide'
require '"Selected hour halo"' "$VIEW" \
  'a selected hour needs a high-contrast point halo'

require 'rollingWindow: isRollingHourly ? forecast.rollingHourlyWindow(now: now) : nil' "$PREVIEW" \
  'the rolling Hourly route must give its overview the same first-24-hour time window'
require 'forecast.hours.filter { $0.date >= window.start && $0.date < window.end }' "$VIEW" \
  'the rolling chart must use actual points across calendar dates'
require 'daylight(at: point.date)?.height(at: point.date)' "$VIEW" \
  'the cross-midnight Sun chart must use each sample’s own civil-day solar times'
require 'Text("Next 24h")' "$PREVIEW" \
  'the day picker must offer an explicit rolling-hour return path'
require 'Label("Show next 24 hours", systemImage: "plus")' "$PREVIEW" \
  'the rolling list must let readers continue beyond its initial 24 hours'
require '!isHourly && isToday && !showingQuarterHours && trendPoints.contains' "$PREVIEW" \
  'the compact-strip earlier-guidance caption must not leak into the main hourly view'
require 'isRollingHourly || calendar.isDate(focus, inSameDayAs: displayedDay)' "$PREVIEW" \
  'explicit hourly sky focus must allow tomorrow in the rolling route'
require 'private var explicitHourlySkyFocus: Date?' "$PREVIEW" \
  'scene identity and daylight appearance must share one provider-backed route focus'
require 'if explicitHourlySkyFocus != nil, let isDaylight = livingSkyScene.isDaylight' "$PREVIEW" \
  'automatic appearance must follow an explicitly focused hour across midnight'

printf 'PASS Native Day rhythm view: inspect-in-place interaction, selected gust/accumulation facts, separated series, semantic color, and restrained rain fill\n'
