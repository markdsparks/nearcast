/* Nearcast day-detail sheet, hourly graph, and memory graph overlays. */

/* ---------- Day-detail bottom sheet ---------- */

let dayDetailNavState = null;
const ROLLING_HOURLY_PAGE_SIZE = 24;
const ROLLING_HOURLY_LOAD_AHEAD_PX = 420;

// Collect a single day's hours from the retained forecast and open the sheet.
function openDayFromIndex(i, options = {}) {
  const data = state.forecast;
  if (!data) return;
  if (!Number.isInteger(i) || i < 0 || i >= (data.daily?.time?.length || 0)) return;
  const dayStr = data.daily.time[i];
  const indices = [];
  data.hourly.time.forEach((t, h) => { if (t.startsWith(dayStr)) indices.push(h); });
  const code = representativeDailyCode(data, i);
  const memoryItems = activePlanMemoryEventsForDay(i, data);
  const memoryEvent = planMemoryDetailEventForDay(memoryItems, data);
  openDayDetail({
    indices,
    title: formatDay(data.daily.time[i], i),
    contextLabel: planMemoryDayContextLabel(memoryItems, memoryEvent),
    code,
    stormPotential: hasThunderPotentialForDay(data, i, code),
    isDay: true,
    sunriseISO: data.daily.sunrise[i],
    sunsetISO: data.daily.sunset[i],
    dayIndex: i,
    initialMode: options.initialMode || (memoryEvent ? "hourly" : getDayDetailMode()),
    persistInitialMode: options.persistInitialMode ?? false,
    showNow: i === 0,
    eventWindow: memoryEvent,
    source: "day"
  });
  if (memoryEvent) scrollFocusedSheetHour();
}

// Rolling next-24-hours window from "now".
function rollingHourlyRows(data) {
  const h = data?.hourly;
  if (!h?.time?.length) return [];
  const now = forecastNowMs(data);
  return h.time
    .map((time, index) => ({ time, index, ms: parseForecastTimestamp(time, data) }))
    .filter((row) => row.ms !== null && row.ms >= now - 60 * 60 * 1000);
}

function rollingWindowTitle(block = 0) {
  if (block <= 0) return "Next 24 Hours";
  return `${block * 24}-${(block + 1) * 24} Hours Out`;
}

function rollingWindowNavLabel(block = 0) {
  if (block <= 0) return "Next 24 hours";
  return `${block * 24}-${(block + 1) * 24} hours out`;
}

function rollingWindowDayLabel(date, data) {
  const diff = daysFromForecastToday(date, data);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${date}T12:00:00`));
}

function rollingWindowEndpoint(ms, data) {
  const day = forecastLocalDateFromMs(ms, data);
  return {
    day,
    dayLabel: rollingWindowDayLabel(day, data),
    timeLabel: formatForecastMs(ms, data)
  };
}

function rollingWindowRangeLabel(rows, allRows, data) {
  if (!rows.length) return "";
  const first = rows[0];
  const last = rows[rows.length - 1];
  const allIndex = allRows.findIndex((row) => row.index === last.index);
  const next = allIndex >= 0 ? allRows[allIndex + 1] : null;
  const endMs = next?.ms ?? (last.ms + 60 * 60 * 1000);
  const start = rollingWindowEndpoint(first.ms, data);
  const end = rollingWindowEndpoint(endMs, data);
  if (start.day === end.day) return `${start.dayLabel} ${start.timeLabel}-${end.timeLabel}`;
  return `${start.dayLabel} ${start.timeLabel}-${end.dayLabel} ${end.timeLabel}`;
}

function openNext24Detail(options = {}) {
  const data = state.forecast;
  if (!data) return;
  const { eventWindow = null, contextLabel = "", block = 0 } = options || {};
  const safeBlock = Math.max(0, Math.floor(Number(block) || 0));
  const rows = rollingHourlyRows(data);
  const start = safeBlock * 24;
  const windowRows = rows.slice(start, start + 24);
  const nextCount = Math.min(start + ROLLING_HOURLY_PAGE_SIZE, rows.length);
  if (!windowRows.length) return;
  const indices = windowRows.map((row) => row.index);
  const firstIndex = indices[0];
  const firstDay = datePart(data.hourly.time[firstIndex]);
  const firstDayIndex = Math.max(0, data.daily?.time?.findIndex((time) => datePart(time) === firstDay) ?? 0);
  const displayCondition = currentDisplayCondition(data);
  const code = safeBlock === 0
    ? (displayCondition.nowCode ?? state.weatherTruth?.nowCode ?? state.weatherTruth?.code ?? displayCondition.code)
    : representativeHourlyCodeForIndices(data, indices);
  const firstHourIsDay = data.hourly.is_day ? Boolean(data.hourly.is_day[firstIndex]) : displayCondition.isDay;
  const rangeLabel = rollingWindowRangeLabel(windowRows, rows, data);
  const detailContext = [rangeLabel, contextLabel].filter(Boolean).join(" · ");
  openDayDetail({
    indices,
    title: rollingWindowTitle(safeBlock),
    code,
    stormPotential: hasThunderPotentialForIndices(data, indices, code),
    isDay: safeBlock === 0 ? displayCondition.isDay : firstHourIsDay,
    sunriseISO: data.daily.sunrise[firstDayIndex],
    sunsetISO: data.daily.sunset[firstDayIndex],
    dayIndex: firstDayIndex,
    initialMode: "hourly",
    persistInitialMode: false,
    showNow: safeBlock === 0,
    eventWindow,
    contextLabel: detailContext,
    source: "rolling",
    navState: {
      block: safeBlock,
      canPrev: safeBlock > 0,
      canNext: start + 24 < rows.length,
      label: rollingWindowNavLabel(safeBlock),
      timeline: {
        allRows: rows,
        start,
        renderedCount: nextCount,
        pageSize: ROLLING_HOURLY_PAGE_SIZE,
        lastDay: null
      }
    }
  });
  if (eventWindow) scrollFocusedSheetHour();
}

function openHourlyStripDetail(hourIndex) {
  const data = state.forecast;
  const index = Number(hourIndex);
  if (!data || !Number.isInteger(index) || !data.hourly?.time?.[index]) {
    openNext24Detail();
    return;
  }
  const startMs = parseForecastTimestamp(data.hourly.time[index], data);
  if (startMs === null) {
    openNext24Detail();
    return;
  }
  const nextMs = data.hourly.time[index + 1]
    ? parseForecastTimestamp(data.hourly.time[index + 1], data)
    : null;
  const label = isCurrentHour(data.hourly.time[index], data) ? "Now" : formatHour(data.hourly.time[index]);
  openNext24Detail({
    eventWindow: {
      startMs,
      endMs: nextMs && nextMs > startMs ? nextMs : startMs + 60 * 60 * 1000,
      badgeLabel: label,
      label: `${label} detail`
    },
    contextLabel: `${label} focus`
  });
}

function getDayDetailMode() {
  return localStorage.getItem(DAY_DETAIL_MODE_KEY) === "hourly" ? "hourly" : "graph";
}

function isSheetHourlyModeActive() {
  const list = document.getElementById("sheetHourlyList");
  if (list) return !list.hidden;
  return document.getElementById("sheetHourlyMode")?.classList.contains("active") || getDayDetailMode() === "hourly";
}

function setDayDetailMode(mode, persist = true) {
  const normalized = mode === "hourly" ? "hourly" : "graph";
  const graphBtn = document.getElementById("sheetGraphMode");
  const hourlyBtn = document.getElementById("sheetHourlyMode");
  const graphWrap = document.getElementById("sheetGraphWrap");
  const hourlyList = document.getElementById("sheetHourlyList");
  const isHourly = normalized === "hourly";

  graphBtn.classList.toggle("active", !isHourly);
  hourlyBtn.classList.toggle("active", isHourly);
  graphBtn.setAttribute("aria-pressed", String(!isHourly));
  hourlyBtn.setAttribute("aria-pressed", String(isHourly));
  graphWrap.hidden = isHourly;
  hourlyList.hidden = !isHourly;
  const metricToggle = document.getElementById("graphMetricToggle");
  if (metricToggle) metricToggle.hidden = isHourly; // Temp/Wind only applies to the graph
  updateSheetDayNav(normalized);

  if (!isHourly) scheduleGraphCalloutReflow();
  renderRollingTimelineFooter();
  updateSheetNowJump();
  if (isHourly) maybeExtendRollingTimeline();
  if (persist) localStorage.setItem(DAY_DETAIL_MODE_KEY, normalized);
}

function updateSheetDayNav(mode = getDayDetailMode()) {
  const nav = document.getElementById("sheetDayNav");
  if (!nav) return;
  const prev = document.getElementById("sheetPrevDay");
  const next = document.getElementById("sheetNextDay");
  const label = document.getElementById("sheetDayNavLabel");
  const data = dayDetailNavState?.data || state.forecast;
  const dayIndex = dayDetailNavState?.dayIndex;
  const dayCount = data?.daily?.time?.length || 0;
  const isHourly = mode === "hourly";
  const isRolling = dayDetailNavState?.source === "rolling";
  const isDay = dayDetailNavState?.source === "day";
  const canPageDay = isDay && Number.isInteger(dayIndex) && dayCount > 1;
  const canPageRolling = isRolling && (dayDetailNavState.canPrev || dayDetailNavState.canNext);
  const canPage = canPageDay || canPageRolling;
  nav.hidden = !(isHourly && canPage);
  if (!canPage) return;

  nav.classList.toggle("is-rolling", isRolling);
  const canPrev = isRolling ? Boolean(dayDetailNavState.canPrev) : dayIndex > 0;
  const canNext = isRolling ? Boolean(dayDetailNavState.canNext) : dayIndex < dayCount - 1;
  if (prev) {
    prev.textContent = isRolling ? "Earlier" : "‹";
    prev.disabled = !canPrev;
    prev.setAttribute("aria-disabled", String(!canPrev));
    prev.setAttribute("aria-label", isRolling ? "Earlier 24-hour window" : "Previous day");
  }
  if (next) {
    next.textContent = isRolling ? "Later" : "›";
    next.disabled = !canNext;
    next.setAttribute("aria-disabled", String(!canNext));
    next.setAttribute("aria-label", isRolling ? "Later 24-hour window" : "Next day");
  }
  if (label) {
    label.textContent = isRolling
      ? (dayDetailNavState.label || "Next 24 hours")
      : formatDay(data.daily.time[dayIndex], dayIndex);
  }
}

function navigateSheetDay(delta) {
  const stateForNav = dayDetailNavState;
  if (!stateForNav) return;
  if (stateForNav.source === "rolling") {
    const nextBlock = (stateForNav.block || 0) + delta;
    if (nextBlock < 0) return;
    if (delta < 0 && !stateForNav.canPrev) return;
    if (delta > 0 && !stateForNav.canNext) return;
    openNext24Detail({ block: nextBlock });
    return;
  }
  if (stateForNav.source !== "day") return;
  const nextIndex = stateForNav.dayIndex + delta;
  const dayCount = stateForNav.data?.daily?.time?.length || 0;
  if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= dayCount) return;
  openDayFromIndex(nextIndex, {
    initialMode: "hourly",
    persistInitialMode: false
  });
}

function detailHoursForIndices(indices, {
  data = state.forecast,
  alerts = activeAlerts,
  eventWindow = null,
  showNow = false
} = {}) {
  if (!data || !indices.length) return [];
  const eventWindows = detailEventWindows(eventWindow);
  return indices.map((h) => {
    const rawCode = data.hourly.weather_code[h];
    const pop = data.hourly.precipitation_probability[h] || 0;
    const cloud = data.hourly.cloud_cover ? data.hourly.cloud_cover[h] : null;
    const precip = data.hourly.precipitation[h] || 0;
    const code = effectiveWeatherCode(rawCode, pop, cloud, precip, { data });
    const truth = state.weatherTruth;
    const ms = parseForecastTimestamp(data.hourly.time[h], data);
    const nextMs = indices.includes(h + 1)
      ? parseForecastTimestamp(data.hourly.time[h + 1], data)
      : ms !== null ? ms + 60 * 60 * 1000 : null;
    const matchedEventWindows = matchingDetailEventWindows(eventWindows, ms, nextMs);
    const inEvent = Boolean(matchedEventWindows.length);
    const eventMemoryIds = matchedEventWindows.map((window) => window.memoryId).filter(Boolean);
    const hourIsDay = data.hourly.is_day ? Boolean(data.hourly.is_day[h]) : true;
    const isNowHour = showNow && isCurrentHour(data.hourly.time[h], data);
    const activePrecip = Boolean(isNowHour && truth?.precip?.phase === "active");
    const truthCode = truth?.nowCode ?? truth?.code ?? code;
    const truthPrecip = truth?.display?.precip ?? truth?.nowPrecip?.amount ?? precip;
    const precipSource = truth?.precip?.source || truth?.source || "";
    return {
      time: data.hourly.time[h],
      ms,
      endMs: nextMs,
      temp: data.hourly.temperature_2m[h],
      feels: data.hourly.apparent_temperature[h],
      pop,
      precip: activePrecip ? Math.max(precip, truthPrecip || 0) : precip,
      wind: data.hourly.wind_speed_10m[h],
      gust: data.hourly.wind_gusts_10m[h],
      uv: data.hourly.uv_index[h] || 0,
      rawCode,
      code: isNowHour ? truthCode : code,
      activePrecip,
      rainText: activePrecip ? "Now" : "",
      precipText: activePrecip
        ? truthPrecip > 0 ? "" : precipSource === "radar-current" ? "On radar" : "Detected"
        : "",
      precipSource,
      precipDetail: activePrecip ? (truth?.surfaceDetail || truth?.receiptDetail || truth?.receipt || "") : "",
      stormPotential: hasThunderPotential(rawCode, pop, isNowHour ? truthCode : code, activePrecip ? Math.max(precip, truthPrecip || 0) : precip, data),
      alert: ms !== null && nextMs !== null ? topAlertForRange(ms, nextMs, alerts) : null,
      inEvent,
      eventLabel: inEvent ? detailEventBadgeLabel(matchedEventWindows, eventWindow) : "",
      eventMemoryIds,
      isDay: isNowHour ? (truth?.isDay ?? currentLocalDaylightIsDay(data, hourIsDay)) : hourIsDay
    };
  });
}

function openDayDetail({
  indices,
  title,
  code,
  stormPotential = false,
  isDay,
  sunriseISO,
  sunsetISO,
  dayIndex = 0,
  initialMode = getDayDetailMode(),
  persistInitialMode = false,
  showNow = false,
  data = state.forecast,
  alerts = activeAlerts,
  eventWindow = null,
  contextLabel = "",
  source = "day",
  navState = null
}) {
  if (!data || !indices.length) return;
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const precipUnit = state.unit === "fahrenheit" ? "in" : "mm";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const hrs = detailHoursForIndices(indices, { data, alerts, eventWindow, showNow });

  const temps = hrs.map((h) => h.temp);
  const high = Math.round(Math.max(...temps));
  const low = Math.round(Math.min(...temps));

  document.getElementById("sheetTitle").textContent = title;
  const sheetContext = document.getElementById("sheetContext");
  if (sheetContext) {
    sheetContext.textContent = contextLabel || "";
    sheetContext.hidden = !contextLabel;
  }
  document.getElementById("sheetIcon").classList.toggle("weather-icon-with-badge", stormPotential);
  document.getElementById("sheetIcon").innerHTML = weatherIcon(code, isDay) + (stormPotential ? thunderBadgeHtml() : "");
  document.getElementById("sheetHigh").textContent = `${high}${degree(tempUnit)}`;
  document.getElementById("sheetLow").textContent = `${low}${degree(tempUnit)}`;
  document.getElementById("sheetSummary").textContent = buildDaySummary(hrs, windUnit);

  graphMetric = "temp"; // each open defaults to Temp (with the Feels-like overlay)
  dayDetailNavState = { source, dayIndex, data, eventWindow, ...(navState || {}) };
  if (dayDetailNavState.timeline) dayDetailNavState.timeline.lastDay = null;
  buildHourlyGraph(hrs, tempUnit, windUnit, showNow, { dayIndex, sunriseISO, sunsetISO, data, eventWindow });
  const listRender = renderHourlyList(hrs, tempUnit, windUnit, precipUnit, {
    showNow,
    data,
    eventWindow,
    showInitialDayDivider: source === "rolling"
  });
  if (dayDetailNavState.timeline) dayDetailNavState.timeline.lastDay = listRender?.lastDay || null;
  renderSheetStats(hrs, { sunriseISO, sunsetISO, windUnit, precipUnit });
  setDayDetailMode(initialMode, persistInitialMode);
  renderRollingTimelineFooter();
  updateSheetNowJump();

  const backdrop = document.getElementById("dayDetailBackdrop");
  const sheet = document.getElementById("dayDetail");
  backdrop.hidden = false;
  sheet.hidden = false;
  showSheet(backdrop, sheet);
  document.body.style.overflow = "hidden";
  maybeExtendRollingTimeline();
}

function closeDayDetail() {
  const backdrop = document.getElementById("dayDetailBackdrop");
  const sheet = document.getElementById("dayDetail");
  const returnToPlanner = plannerReturnAfterDayDetail;
  plannerReturnAfterDayDetail = null;
  dayDetailNavState = null;
  document.getElementById("sheetNowJump")?.setAttribute("hidden", "");
  document.getElementById("sheetTimelineFooter")?.setAttribute("hidden", "");
  backdrop.classList.remove("show");
  sheet.classList.remove("show");
  document.body.style.overflow = returnToPlanner ? "hidden" : "";
  setTimeout(() => {
    backdrop.hidden = true;
    sheet.hidden = true;
    if (returnToPlanner) {
      openAISheet({ restoreScroll: returnToPlanner.scrollTop, autoBrief: false });
    }
  }, 260);
}

function buildDaySummary(hrs, windUnit) {
  const maxPop = Math.max(...hrs.map((h) => h.pop));
  const maxGust = Math.round(Math.max(...hrs.map((h) => h.gust)));
  const thunder = hrs.some((h) => isThunderCode(h.code) || h.stormPotential);
  const parts = [];
  if (thunder) parts.push(`Thunder possible${maxPop >= 20 ? `, up to ${maxPop}% rain` : ""}`);
  else if (maxPop >= 50) parts.push(`Rain likely, up to ${maxPop}% chance`);
  else if (maxPop >= 20) parts.push(`Slight chance of rain (${maxPop}%)`);
  else parts.push("Mostly dry");
  if (maxGust >= 25) parts.push(`gusts to ${maxGust} ${windUnit}`);
  return parts.join(", ") + ".";
}

function hourlyRowSignals(hour, tempUnit, windUnit, precipUnit) {
  const deg = degree(tempUnit);
  const feelsDelta = Math.round(hour.feels - hour.temp);
  const windy = hour.gust >= 20 && hour.gust >= hour.wind + 5;
  const signals = [];

  if (hour.alert) {
    signals.push({ label: alertToneLabel(alertTone(hour.alert)), tone: ` is-alert is-alert-${alertTone(hour.alert)}` });
  }

  if (hour.stormPotential) {
    signals.push({ label: "Thunder", tone: " is-storm" });
  }

  if (hour.activePrecip) {
    signals.push({ label: "Rain now", tone: " is-wet" });
  } else if (hour.pop >= 20) {
    signals.push({ label: `${hour.pop}% rain`, tone: hour.pop >= 40 ? " is-wet" : "" });
  }

  if (hour.activePrecip && hour.precipText) {
    signals.push({ label: hour.precipText, tone: " is-flag" });
  } else if (hour.precip > 0.02) {
    signals.push({ label: `${formatAmount(hour.precip)} ${precipUnit}`, tone: " is-flag" });
  } else if (windy) {
    signals.push({ label: `Gust ${Math.round(hour.gust)}`, tone: " is-wind" });
  } else if (hour.uv >= 6) {
    signals.push({ label: `UV ${Math.round(hour.uv)}`, tone: " is-flag" });
  } else if (Math.abs(feelsDelta) >= 6) {
    signals.push({ label: `Feels ${feelsDelta > 0 ? "+" : ""}${feelsDelta}${deg}`, tone: " is-flag" });
  }

  if (signals.length < 2) {
    signals.push({ label: `${Math.round(hour.wind)} ${windUnit}`, tone: "" });
  }

  return signals.slice(0, 2);
}

function hourlyDetailNote(hour, tempUnit, windUnit) {
  const alertNote = hour.alert ? hourlyAlertDetailNote(hour.alert) : "";
  let weatherNote = "";
  if (hour.activePrecip) {
    const source = hour.precipSource === "radar-current"
      ? "Radar shows precipitation over this place now."
      : hour.precipSource === "minutely-current"
        ? "The near-term forecast has precipitation in the current slot."
        : "Precipitation is happening now.";
    weatherNote = `${source} Hourly probability can lag observed conditions.`;
  } else if (isThunderCode(hour.code) || hour.stormPotential) {
    const stormCode = hour.rawCode || hour.code;
    const hail = stormCode === 96 || stormCode === 99 ? " Hail is also possible." : "";
    weatherNote = isThunderCode(hour.code)
      ? `Watch for lightning and quick downpours.${hail}`
      : `Thunder possible. Watch for lightning and quick downpours.${hail}`;
  } else if (isPrecipCode(hour.code)) {
    const likelihood = hour.pop >= 50 ? "Likely" : "Possible";
    const burst = hour.code === 65 || hour.code === 67 || hour.code === 82 || hour.code === 86
      ? " Brief heavier bursts are possible."
      : "";
    weatherNote = `${likelihood} through this hour.${burst}`;
  } else if (hour.pop >= 50) {
    weatherNote = "Rain likely through this hour.";
  } else if (hour.gust >= 25) {
    weatherNote = `Gusts near ${Math.round(hour.gust)} ${windUnit}.`;
  } else if (hour.uv >= 6) {
    weatherNote = `High UV. Sunscreen helps outdoors.`;
  } else {
    const feelsDelta = Math.round(hour.feels - hour.temp);
    weatherNote = Math.abs(feelsDelta) >= 6
      ? `Feels ${Math.abs(feelsDelta)}${degree(tempUnit)} ${feelsDelta > 0 ? "warmer" : "cooler"} than the air temp.`
      : "No major weather flags.";
  }

  if (!alertNote) return weatherNote;
  if (weatherNote === "No major weather flags.") return alertNote;
  return `${alertNote} ${weatherNote}`;
}

function hourlyAlertDetailNote(alert) {
  const tone = alertTone(alert);
  const event = alert?.event || alertToneLabel(tone);
  if (tone === "warning") return `${event} active. Check alert details and follow local guidance.`;
  if (tone === "watch") return `${event} active. Stay weather aware.`;
  if (tone === "advisory") return `${event} active.`;
  return `${event} active for this hour.`;
}

function toggleSheetHourRow(row) {
  const list = document.getElementById("sheetHourlyList");
  const shouldOpen = !row.classList.contains("is-expanded");
  list.querySelectorAll(".sheet-hour-row.is-expanded").forEach((openRow) => {
    setSheetHourRowExpanded(openRow, false);
  });
  if (shouldOpen) setSheetHourRowExpanded(row, true);
}

function setSheetHourRowExpanded(row, expanded) {
  row.classList.toggle("is-expanded", expanded);
  row.setAttribute("aria-expanded", String(expanded));
  const detail = row.querySelector(".sheet-hour-detail");
  if (detail) detail.hidden = !expanded;
}

function isCurrentHour(time, data = state.forecast) {
  const target = localDateTimeParts(time);
  const current = localDateTimeParts(data?.current?.time);
  if (target && current) {
    return target.year === current.year &&
      target.month === current.month &&
      target.day === current.day &&
      target.hour === current.hour;
  }
  const targetMs = parseForecastTimestamp(time, data);
  const now = forecastNowMs(data);
  return targetMs !== null && Math.abs(targetMs - now) < 1800000;
}

function plannerEventFocusIndex(hrs) {
  let best = -1;
  let bestScore = -Infinity;
  hrs.forEach((hour, index) => {
    if (!hour.inEvent) return;
    const score =
      (hour.alert ? 500 + alertPriority(hour.alert) : 0) +
      (hour.stormPotential ? 260 : 0) +
      (hour.pop || 0) * 2 +
      Math.max(0, (hour.gust || 0) - 18) * 8 +
      Math.max(0, (hour.uv || 0) - 5) * 14 +
      (hour.precip || 0) * 80;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

function renderHourlyRowsMarkup(hrs, tempUnit, windUnit, precipUnit, options = {}) {
  const opts = typeof options === "boolean" ? { showNow: options } : (options || {});
  const {
    showNow = false,
    data = state.forecast,
    eventWindow = null,
    startRowIndex = 0,
    previousDay = null,
    allowEventFocus = true,
    showInitialDayDivider = false
  } = opts;
  const deg = degree(tempUnit);
  const defaultExpandedIndex = allowEventFocus && eventWindow ? plannerEventFocusIndex(hrs) : -1;
  let prevDay = previousDay;
  const html = hrs.map((hour, rowOffset) => {
    const rowIndex = startRowIndex + rowOffset;
    const dayKey = hour.time.slice(0, 10);
    const divider = (prevDay && dayKey !== prevDay) || (!prevDay && showInitialDayDivider)
      ? `<div class="sheet-day-divider"><span>${escapeHtml(dayDividerLabel(hour.time))}</span></div>`
      : "";
    prevDay = dayKey;
    const condition = weatherCodes[hour.code] || "Weather";
    const signals = hourlyRowSignals(hour, tempUnit, windUnit, precipUnit);
    const detailNote = hourlyDetailNote(hour, tempUnit, windUnit);
    const windy = hour.gust >= 20 && hour.gust >= hour.wind + 5;
    const now = showNow && isCurrentHour(hour.time, data);
    const rainClass = hour.activePrecip || hour.pop >= 40 ? " is-rainy" : "";
    const uvClass = hour.uv >= 6 ? " is-sunny" : "";
    const windClass = hour.gust >= 25 ? " is-windy" : "";
    const stormClass = hour.stormPotential ? " is-stormy" : "";
    const alertClass = hour.alert ? ` has-alert is-alert-${alertTone(hour.alert)}` : "";
    const nowClass = now ? " is-now" : "";
    const eventClass = hour.inEvent ? " is-plan-window" : "";
    const expanded = rowIndex === defaultExpandedIndex;
    const eventBadge = hour.inEvent ? escapeHtml(hour.eventLabel || "Plan") : "";
    const eventBadgeHtml = hour.inEvent
      ? hour.eventMemoryIds?.length
        ? `<button class="sheet-plan-badge" type="button" data-memory-detail="${escapeHtml(hour.eventMemoryIds.join(","))}" aria-label="${escapeHtml(`Show memory details for ${hour.eventLabel || "plan"}`)}">${eventBadge}</button>`
        : `<span class="sheet-plan-badge">${eventBadge}</span>`
      : "";
    const signalChips = signals.map((signal) => `<span class="sheet-hour-chip${signal.tone}">${escapeHtml(signal.label)}</span>`).join("");
    const detailId = `sheet-hour-detail-${rowIndex}`;
    const rowLabel = `${formatHour(hour.time)} ${condition}${hour.eventLabel ? `, memory ${hour.eventLabel}` : ""}${hour.stormPotential ? ", thunder possible" : ""}${hour.alert ? `, ${hour.alert.event}` : ""}, ${Math.round(hour.temp)}${deg}, ${signals.map((signal) => signal.label).join(", ")}`;
    const rainText = hour.rainText || `${hour.pop}%`;
    const precipText = hour.precipText || (hour.precip > 0 ? `${formatAmount(hour.precip)} ${precipUnit}` : `0 ${precipUnit}`);
    return `${divider}
      <article class="sheet-hour-row${rainClass}${uvClass}${windClass}${stormClass}${alertClass}${nowClass}${eventClass}${expanded ? " is-expanded" : ""}" role="button" tabindex="0" aria-label="${escapeHtml(rowLabel)}" aria-expanded="${expanded}" aria-controls="${detailId}">
        <div class="sheet-hour-time">${formatHour(hour.time)}${now ? `<span class="sheet-now-badge">Now</span>` : ""}${eventBadgeHtml}</div>
        <div class="sheet-hour-icon weather-icon-with-badge" aria-hidden="true">${weatherIcon(hour.code, hour.isDay, { density: "dense" })}${hour.stormPotential ? thunderBadgeHtml() : ""}</div>
        <div class="sheet-hour-main">
          <strong>${Math.round(hour.temp)}${deg}</strong>
        </div>
        <div class="sheet-hour-signals">
          ${signalChips}
          <span class="sheet-hour-cue" aria-hidden="true"></span>
        </div>
        <div class="sheet-hour-detail" id="${detailId}"${expanded ? "" : " hidden"}>
          <h3 class="sheet-hour-detail-condition">${escapeHtml(condition)}</h3>
          <p>${escapeHtml(detailNote)}</p>
          <div class="sheet-hour-detail-grid">
            <span><small>Feels</small><strong>${Math.round(hour.feels)}${deg}</strong></span>
            <span><small>Rain</small><strong>${escapeHtml(rainText)}</strong></span>
            <span><small>Precip</small><strong>${escapeHtml(precipText)}</strong></span>
            <span><small>Wind</small><strong>${Math.round(hour.wind)} ${windUnit}</strong></span>
            <span><small>Gust</small><strong>${Math.round(hour.gust)} ${windUnit}</strong></span>
            <span><small>UV</small><strong>${Math.round(hour.uv)}</strong></span>
          </div>
        </div>
      </article>
    `;
  }).join("");
  return { html, lastDay: prevDay };
}

function renderHourlyList(hrs, tempUnit, windUnit, precipUnit, options = {}) {
  const list = document.getElementById("sheetHourlyList");
  const result = renderHourlyRowsMarkup(hrs, tempUnit, windUnit, precipUnit, options);
  list.innerHTML = result.html;
  return result;
}

function handleDayDetailScroll() {
  maybeExtendRollingTimeline();
  updateSheetNowJump();
}

function maybeExtendRollingTimeline(force = false) {
  const sheet = document.getElementById("dayDetail");
  const timeline = dayDetailNavState?.timeline;
  if (!sheet || sheet.hidden || !timeline || dayDetailNavState?.source !== "rolling" || !isSheetHourlyModeActive()) {
    renderRollingTimelineFooter();
    updateSheetNowJump();
    return false;
  }
  const remaining = sheet.scrollHeight - sheet.scrollTop - sheet.clientHeight;
  if (!force && remaining > ROLLING_HOURLY_LOAD_AHEAD_PX) {
    renderRollingTimelineFooter();
    updateSheetNowJump();
    return false;
  }
  const appended = appendRollingHourlyRows();
  renderRollingTimelineFooter();
  updateSheetNowJump();
  return appended;
}

function appendRollingHourlyRows() {
  const timeline = dayDetailNavState?.timeline;
  const data = dayDetailNavState?.data || state.forecast;
  if (!timeline || !data || timeline.renderedCount >= timeline.allRows.length) return false;
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const precipUnit = state.unit === "fahrenheit" ? "in" : "mm";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const nextCount = Math.min(timeline.renderedCount + timeline.pageSize, timeline.allRows.length);
  const rows = timeline.allRows.slice(timeline.renderedCount, nextCount);
  if (!rows.length) return false;
  const hrs = detailHoursForIndices(rows.map((row) => row.index), {
    data,
    alerts: activeAlerts,
    eventWindow: dayDetailNavState.eventWindow,
    showNow: false
  });
  const rowStart = Math.max(0, timeline.renderedCount - timeline.start);
  const result = renderHourlyRowsMarkup(hrs, tempUnit, windUnit, precipUnit, {
    showNow: false,
    data,
    eventWindow: dayDetailNavState.eventWindow,
    startRowIndex: rowStart,
    previousDay: timeline.lastDay,
    allowEventFocus: false
  });
  document.getElementById("sheetHourlyList")?.insertAdjacentHTML("beforeend", result.html);
  timeline.renderedCount = nextCount;
  timeline.lastDay = result.lastDay || timeline.lastDay || null;
  return true;
}

function renderRollingTimelineFooter() {
  const footer = document.getElementById("sheetTimelineFooter");
  if (!footer) return;
  const timeline = dayDetailNavState?.timeline;
  const visible = Boolean(timeline && dayDetailNavState?.source === "rolling" && isSheetHourlyModeActive());
  footer.hidden = !visible;
  if (!visible) return;
  const shown = Math.max(0, (timeline.renderedCount || 0) - (timeline.start || 0));
  const total = Math.max(0, (timeline.allRows?.length || 0) - (timeline.start || 0));
  footer.textContent = timeline.renderedCount < timeline.allRows.length
    ? `${shown} of ${total} forecast hours`
    : `End of hourly forecast · ${shown || total} hours shown`;
}

function updateSheetNowJump() {
  const jump = document.getElementById("sheetNowJump");
  const sheet = document.getElementById("dayDetail");
  const memorySheet = document.getElementById("memoryDetailSheet");
  const timeline = dayDetailNavState?.timeline;
  if (!jump || !sheet) return;
  const show = !sheet.hidden &&
    Boolean(memorySheet?.hidden ?? true) &&
    dayDetailNavState?.source === "rolling" &&
    isSheetHourlyModeActive() &&
    Boolean(timeline) &&
    (sheet.scrollTop > 520 || (timeline.start || 0) > 0);
  jump.hidden = !show;
}

function scrollDayDetailToNow() {
  const timeline = dayDetailNavState?.timeline;
  if (dayDetailNavState?.source === "rolling" && timeline && (timeline.start || 0) > 0) {
    openNext24Detail();
    return;
  }
  const sheet = document.getElementById("dayDetail");
  if (!sheet) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  sheet.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  updateSheetNowJump();
}

// Build a smooth cardinal-spline path through the points.
function smoothPath(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function shortHour(t) {
  const parts = localDateTimeParts(t);
  if (parts) return formatClock(parts.hour, 0, true, false);
  const h = new Date(t).getHours();
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${h < 12 ? "a" : "p"}`;
}

let graphPts = [];
let graphActiveIndex = 0;
let graphUpdateActive = null;

function scheduleGraphCalloutReflow() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (typeof graphUpdateActive === "function") {
        graphUpdateActive(graphActiveIndex);
      }
    });
  });
}

// The graph can plot two metrics, each as a primary curve + a dashed secondary
// curve: Temp (with Feels-like) by default, or Wind (with Gusts). The current
// metric + last-rendered context are kept so the toggle can redraw in place.
let graphMetric = "temp";
let graphCtx = null;
const GRAPH_WIND_COLOR = "#8479ff";

function setGraphMetric(metric) {
  graphMetric = metric === "wind" || metric === "sun" ? metric : "temp";
  if (graphCtx) drawHourlyGraph();
}

function buildHourlyGraph(hrs, tempUnit, windUnit, showNow = false, options = {}) {
  graphCtx = { hrs, tempUnit, windUnit, showNow, ...options };
  drawHourlyGraph();
}

function drawHourlyGraph() {
  if (!graphCtx) return;
  const perf = perfStart();
  const { hrs, tempUnit, windUnit, showNow, data = state.forecast } = graphCtx;
  const isWind = graphMetric === "wind";
  const isSun = graphMetric === "sun";

  // Reflect the active metric in the toggle + hint.
  const tempBtn = document.getElementById("graphTempBtn");
  const windBtn = document.getElementById("graphWindBtn");
  const sunBtn = document.getElementById("graphSunBtn");
  const hint = document.getElementById("graphMetricHint");
  if (tempBtn && windBtn && sunBtn) {
    tempBtn.classList.toggle("active", !isWind && !isSun);
    windBtn.classList.toggle("active", isWind);
    sunBtn.classList.toggle("active", isSun);
    tempBtn.setAttribute("aria-pressed", String(!isWind && !isSun));
    windBtn.setAttribute("aria-pressed", String(isWind));
    sunBtn.setAttribute("aria-pressed", String(isSun));
  }
  if (hint) hint.textContent = isSun ? "orange = higher UV" : isWind ? "dashed = gusts" : "dashed = feels like";
  if (isSun) {
    drawSunGraph();
    perfEnd("drawHourlyGraph", perf);
    return;
  }
  document.getElementById("sheetReadout")?.classList.remove("is-sun");

  const VW = 340;
  const padL = 18, padR = 18;
  const plotW = VW - padL - padR;
  const tempTop = 18, tempBottom = 104;
  const precipTop = 116, precipBottom = 136;
  const precipH = precipBottom - precipTop;
  const labelY = 152;
  const n = hrs.length;

  const primaryKey = isWind ? "wind" : "temp";
  const secondaryKey = isWind ? "gust" : "feels";
  const unitSuffix = isWind ? ` ${windUnit}` : degree(tempUnit);
  const fmt = (v) => `${Math.round(v)}${unitSuffix}`;

  const primaryVals = hrs.map((h) => h[primaryKey]);
  const secondaryVals = hrs.map((h) => h[secondaryKey]);
  const all = primaryVals.concat(secondaryVals);
  let vMin = Math.min(...all), vMax = Math.max(...all);
  if (isWind) vMin = Math.min(vMin, 0); // wind reads naturally from a 0 baseline
  const range = Math.max(vMax - vMin, 1);
  const dMin = vMin - range * 0.18, dMax = vMax + range * 0.18;
  const dRange = dMax - dMin;

  const x = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yv = (v) => tempBottom - ((v - dMin) / dRange) * (tempBottom - tempTop);

  const pPts = hrs.map((h, i) => ({ ...h, x: x(i), y: yv(h[primaryKey]) }));
  const sPts = hrs.map((h, i) => ({ x: x(i), y: yv(h[secondaryKey]) }));
  const firstMs = parseForecastTimestamp(hrs[0].time, data);
  const lastMs = parseForecastTimestamp(hrs[n - 1].time, data);
  const graphEndMs = firstMs !== null && lastMs !== null && lastMs > firstMs
    ? lastMs
    : firstMs !== null ? firstMs + 60 * 60 * 1000 : null;
  const xForMs = (ms) => {
    if (firstMs === null || graphEndMs === null || graphEndMs <= firstMs) return padL + plotW / 2;
    return padL + ((clamp(ms, firstMs, graphEndMs) - firstMs) / (graphEndMs - firstMs)) * plotW;
  };
  const memoryWindows = graphMemoryWindows(hrs, data, graphCtx.eventWindow);
  const memoryBands = renderGraphMemoryBands(memoryWindows, xForMs, {
    top: tempTop,
    bottom: precipBottom,
    labelY: precipTop - 6,
    data
  });
  graphPts = pPts; // scrubbing tracks the primary curve
  graphActiveIndex = 0;
  graphUpdateActive = null;

  // Primary stroke: temp is colored by value (gradient); wind is a solid hue.
  let defs = "";
  let primaryStroke, areaFill, areaOpacity, secondaryStroke;
  if (isWind) {
    primaryStroke = areaFill = secondaryStroke = GRAPH_WIND_COLOR;
    areaOpacity = 0.10;
  } else {
    const gradStops = pPts.map((p, i) =>
      `<stop offset="${((i / Math.max(n - 1, 1)) * 100).toFixed(1)}%" stop-color="${tempColor(p.temp)}"/>`
    ).join("");
    defs = `<linearGradient id="tempGrad" x1="0" y1="0" x2="1" y2="0">${gradStops}</linearGradient>`;
    primaryStroke = areaFill = "url(#tempGrad)";
    secondaryStroke = "var(--ink)";
    areaOpacity = 0.13;
  }

  const primaryPath = smoothPath(pPts);
  const secondaryPath = smoothPath(sPts);
  const areaPath = `${primaryPath} L ${pPts[n - 1].x.toFixed(1)} ${tempBottom} L ${pPts[0].x.toFixed(1)} ${tempBottom} Z`;

  // Precip bars — useful context in either metric.
  const barW = Math.max((plotW / n) * 0.5, 2);
  const precipBars = pPts.map((p) => {
    if (p.pop <= 0) return "";
    const h = (p.pop / 100) * precipH;
    return `<rect x="${(p.x - barW / 2).toFixed(1)}" y="${(precipBottom - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="#4a90d9" opacity="0.5"/>`;
  }).join("");

  // Keep marker labels inside the chart even when a peak lands at an edge.
  const peakText = (px, py, text, cls) => {
    const edge = px < 26 ? { x: 2, anchor: "start" } : px > VW - 26 ? { x: VW - 2, anchor: "end" } : { x: px, anchor: "middle" };
    return `<text x="${edge.x.toFixed(1)}" y="${py.toFixed(1)}" text-anchor="${edge.anchor}" class="${cls}">${text}</text>`;
  };

  // Markers: temp shows hi/lo; wind shows peak wind + peak gust.
  let markers;
  if (isWind) {
    const wIdx = primaryVals.indexOf(Math.max(...primaryVals));
    const gIdx = secondaryVals.indexOf(Math.max(...secondaryVals));
    markers =
      `<circle cx="${pPts[wIdx].x.toFixed(1)}" cy="${pPts[wIdx].y.toFixed(1)}" r="2.6" fill="${GRAPH_WIND_COLOR}"/>` +
      peakText(pPts[wIdx].x, pPts[wIdx].y - 7, fmt(primaryVals[wIdx]), "graph-peak") +
      peakText(sPts[gIdx].x, sPts[gIdx].y - 6, `gust ${fmt(secondaryVals[gIdx])}`, "graph-peak-sub");
  } else {
    const tMax = Math.max(...primaryVals), tMin = Math.min(...primaryVals);
    const hiIdx = primaryVals.indexOf(tMax), loIdx = primaryVals.indexOf(tMin);
    markers =
      `<circle cx="${pPts[hiIdx].x.toFixed(1)}" cy="${pPts[hiIdx].y.toFixed(1)}" r="2.6" fill="${tempColor(tMax)}"/>` +
      peakText(pPts[hiIdx].x, pPts[hiIdx].y - 7, fmt(tMax), "graph-peak") +
      `<circle cx="${pPts[loIdx].x.toFixed(1)}" cy="${pPts[loIdx].y.toFixed(1)}" r="2.6" fill="${tempColor(tMin)}"/>` +
      peakText(pPts[loIdx].x, pPts[loIdx].y + 13, fmt(tMin), "graph-peak");
  }

  // X-axis time labels
  const steps = 4;
  const labelIdx = [...new Set(Array.from({ length: steps + 1 }, (_, s) => Math.round((s * (n - 1)) / steps)))];
  const axisLabels = labelIdx.map((i) =>
    `<text x="${x(i).toFixed(1)}" y="${labelY}" text-anchor="middle" class="graph-axis">${shortHour(hrs[i].time)}</text>`
  ).join("");

  // Vertical line at each midnight so the day rollover is visible on the curve.
  const dayLines = hrs.map((h, i) => {
    if (i === 0 || Math.floor(forecastLocalHour(h.time)) !== 0) return "";
    const lx = x(i);
    const nearRight = lx > VW - 46;
    const tx = nearRight ? lx - 4 : lx + 4;
    const anchor = nearRight ? "end" : "start";
    return `<line x1="${lx.toFixed(1)}" y1="${tempTop}" x2="${lx.toFixed(1)}" y2="${precipBottom}" class="graph-day-line"/>` +
      `<text x="${tx.toFixed(1)}" y="${(tempTop + 9).toFixed(1)}" text-anchor="${anchor}" class="graph-day-label">${escapeHtml(dayShortLabel(h.time))}</text>`;
  }).join("");

  const nowMs = forecastNowMs(data);
  const nowX = firstMs !== null && lastMs !== null && firstMs < lastMs
    ? padL + ((nowMs - firstMs) / (lastMs - firstMs)) * plotW
    : null;
  const nowMarker = showNow && nowX != null && nowX >= padL && nowX <= padL + plotW ? `
    <line x1="${nowX.toFixed(1)}" y1="${tempTop}" x2="${nowX.toFixed(1)}" y2="${precipBottom}" class="graph-now-line"/>
    <rect x="${(nowX - 13).toFixed(1)}" y="2" width="26" height="14" rx="7" class="graph-now-pill"/>
    <text x="${nowX.toFixed(1)}" y="12" text-anchor="middle" class="graph-now-label">Now</text>
  ` : "";

  document.getElementById("sheetGraph").innerHTML = `
    <svg viewBox="0 0 ${VW} 162" class="hourly-graph">
      <defs>${defs}</defs>
      <path d="${areaPath}" fill="${areaFill}" fill-opacity="${areaOpacity}"/>
      <path d="${secondaryPath}" fill="none" stroke="${secondaryStroke}" stroke-width="1.6" stroke-dasharray="4 3" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
      <path d="${primaryPath}" fill="none" stroke="${primaryStroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      ${precipBars}
      ${dayLines}
      ${markers}
      ${nowMarker}
      ${axisLabels}
      <line id="graphGuide" x1="0" y1="${tempTop}" x2="0" y2="${precipBottom}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3" opacity="0.4" style="display:none"/>
      <circle id="graphDot" r="4" fill="var(--ink)" style="display:none"/>
      <rect id="graphHit" x="0" y="0" width="${VW}" height="${precipBottom}" fill="transparent" style="cursor:crosshair"/>
      ${memoryBands}
    </svg>
  `;

  const svg = document.querySelector("#sheetGraph svg");
  const guide = svg.querySelector("#graphGuide");
  const dot = svg.querySelector("#graphDot");
  const callout = document.getElementById("sheetReadout");
  const wrap = document.getElementById("sheetGraphWrap");

  function update(i) {
    const p = graphPts[i];
    if (!p) return;
    graphActiveIndex = i;
    guide.setAttribute("x1", p.x);
    guide.setAttribute("x2", p.x);
    guide.style.display = "";
    dot.setAttribute("cx", p.x);
    dot.setAttribute("cy", p.y);
    dot.style.display = "";

    const long = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(p.time));
    const main = isWind
      ? `${long} · ${Math.round(p.wind)} ${windUnit}`
      : `${long} · ${Math.round(p.temp)}${degree(tempUnit)}`;
    const sub = isWind
      ? `gust ${Math.round(p.gust)} ${windUnit} · ${p.pop}% rain`
      : `feels ${Math.round(p.feels)}${degree(tempUnit)} · ${p.pop}% · ${Math.round(p.wind)} ${windUnit}`;
    const activeMemory = graphMemoryAtMs(p.ms ?? parseForecastTimestamp(p.time, data), memoryWindows);
    const subText = activeMemory ? `During ${activeMemory.label} · ${sub}` : sub;
    callout.innerHTML =
      `<span class="callout-main">${escapeHtml(main)}</span><span class="callout-sub">${escapeHtml(subText)}</span>`;

    // Slide the callout to ride above the active point, clamped to the chart edges.
    // The vertical guide line marks the exact column; the callout pointer tracks it too.
    const wrapWidth = wrap.clientWidth;
    const cw = callout.offsetWidth;
    if (!wrapWidth || !cw) return;

    const px = (p.x / VW) * wrapWidth;
    const minLeft = cw / 2 + 2;
    const maxLeft = Math.max(minLeft, wrapWidth - cw / 2 - 2);
    const left = Math.max(minLeft, Math.min(px, maxLeft));
    const pointerX = Math.max(8, Math.min(cw - 8, px - (left - cw / 2)));
    callout.style.left = `${left}px`;
    callout.style.setProperty("--pointer-x", `${pointerX}px`);
  }
  graphUpdateActive = update;

  function nearest(clientX) {
    const rect = svg.getBoundingClientRect();
    const vbX = ((clientX - rect.left) / rect.width) * VW;
    let best = 0, bd = Infinity;
    graphPts.forEach((p, idx) => {
      const d = Math.abs(p.x - vbX);
      if (d < bd) { bd = d; best = idx; }
    });
    return best;
  }

  svg.addEventListener("pointermove", (e) => update(nearest(e.clientX)));
  svg.addEventListener("pointerdown", (e) => update(nearest(e.clientX)));

  // Default readout: the hour nearest "now" if present, else the first point.
  const now = forecastNowMs(data);
  let def = hrs.findIndex((h) => {
    const ms = parseForecastTimestamp(h.time, data);
    return ms !== null && Math.abs(ms - now) < 1800000;
  });
  if (def < 0) def = 0;
  // Defer to next frame so the sheet has laid out and the callout can be
  // measured/positioned correctly (it's still hidden when this runs).
  graphActiveIndex = def;
  scheduleGraphCalloutReflow();
  perfEnd("drawHourlyGraph", perf);
}

function drawSunGraph() {
  if (!graphCtx) return;
  const perf = perfStart();
  const { hrs, dayIndex = 0, sunriseISO, sunsetISO, showNow, data = state.forecast } = graphCtx;
  const sunriseMs = sunriseISO ? parseForecastTimestamp(sunriseISO, data) : null;
  const sunsetMs = sunsetISO ? parseForecastTimestamp(sunsetISO, data) : null;
  const tomorrowSunriseISO = data?.daily?.sunrise?.[dayIndex + 1];
  const tomorrowSunriseMs = tomorrowSunriseISO ? parseForecastTimestamp(tomorrowSunriseISO, data) : null;
  const fallbackUv = Math.round(data?.daily?.uv_index_max?.[dayIndex] || Math.max(...hrs.map((h) => h.uv || 0), 0));
  const uv = sunRiskWindow(data, sunriseMs, sunsetMs, fallbackUv, dayIndex);
  const chart = sunChartGeometry(data, sunriseMs, sunsetMs, tomorrowSunriseMs, dayIndex);
  const callout = document.getElementById("sheetReadout");
  const wrap = document.getElementById("sheetGraphWrap");
  const graph = document.getElementById("sheetGraph");
  if (!chart) {
    graph.innerHTML = `<div class="sheet-empty">Sun data unavailable.</div>`;
    callout.innerHTML = "";
    callout.classList.remove("is-sun");
    perfEnd("drawSunGraph", perf);
    return;
  }

  const VW = chart.width;
  const showUvBand = uv.showBand && uv.startMs && uv.endMs && uv.endMs > uv.startMs;
  const nightPath = chart.mode === "polar-day" ? "" : sunPathSegment(chart, chart.dayStartMs, chart.dayEndMs, 96);
  const dayPath = chart.mode === "polar-night" ? "" : sunPathSegment(chart, chart.daylightStartMs, chart.daylightEndMs, 64);
  const uvPath = showUvBand ? sunPathSegment(chart, uv.startMs, uv.endMs, 24) : "";
  const peakMs = uv.peakMs || sunPeakMs(chart);
  const peakPoint = peakMs ? sunPathPoint(chart, peakMs) : null;
  const nowMs = forecastNowMs(data);
  const nowPoint = sunPathPoint(chart, nowMs);
  const nowMarker = showNow && nowMs >= chart.dayStartMs && nowMs <= chart.dayEndMs ? `
    <g>
      <line x1="${roundSvg(nowPoint.x)}" y1="12" x2="${roundSvg(nowPoint.x)}" y2="122" class="graph-now-line"/>
      <rect x="${roundSvg(clamp(nowPoint.x - 16, 0, chart.width - 32))}" y="4" width="32" height="16" rx="8" class="graph-now-pill"/>
      <text x="${roundSvg(nowPoint.x)}" y="15" text-anchor="middle" class="graph-now-label">Now</text>
    </g>
  ` : "";
  const uvMarker = peakPoint && uv.showMarker ? `
    <circle cx="${roundSvg(peakPoint.x)}" cy="${roundSvg(peakPoint.y)}" r="3.2" class="sun-uv-dot"/>
  ` : "";
  const activeMs = showNow ? nowMs : parseForecastTimestamp(hrs[0]?.time, data) ?? chart.daylightStartMs;
  const memoryWindows = graphMemoryWindows(hrs, data, graphCtx.eventWindow);
  const sunXForMs = (ms) => sunPathPoint(chart, clamp(ms, chart.dayStartMs, chart.dayEndMs)).x;
  const memoryBands = renderGraphMemoryBands(memoryWindows, sunXForMs, {
    top: 12,
    bottom: 122,
    labelY: 25,
    minLabelWidth: 42,
    data
  });

  graphPts = buildDaylightScrubPoints(data, chart);
  graphActiveIndex = nearestGraphSunIndexByMs(activeMs);
  graphUpdateActive = null;

  graph.innerHTML = `
    <svg viewBox="0 0 ${VW} 152" class="hourly-graph sun-graph uv-${uv.severity}">
      <line class="daylight-horizon" x1="${chart.left}" y1="${chart.horizonY}" x2="${chart.right}" y2="${chart.horizonY}"></line>
      <path class="daylight-night-arc" d="${nightPath}"></path>
      <path class="daylight-fill" d="${dayPath}"></path>
      <path class="daylight-uv-band" d="${uvPath}" ${showUvBand ? "" : "hidden"}></path>
      ${uvMarker}
      ${nowMarker}
      <text x="${chart.left}" y="148" text-anchor="start" class="graph-axis">${escapeHtml(chart.mode === "normal" && sunriseISO ? formatTime(sunriseISO) : chart.mode === "polar-day" ? "All day" : "No sunrise")}</text>
      <text x="${chart.right}" y="148" text-anchor="end" class="graph-axis">${escapeHtml(chart.mode === "normal" && sunsetISO ? formatTime(sunsetISO) : chart.mode === "polar-day" ? "No sunset" : "No sunset")}</text>
      <line id="graphGuide" x1="0" y1="12" x2="0" y2="122" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3" opacity="0.4" style="display:none"/>
      <circle id="graphDot" r="4.5" fill="var(--ink)" style="display:none"/>
      <rect id="graphHit" x="0" y="0" width="${VW}" height="136" fill="transparent" style="cursor:crosshair"/>
      ${memoryBands}
    </svg>
  `;

  const svg = graph.querySelector("svg");
  const guide = svg.querySelector("#graphGuide");
  const dot = svg.querySelector("#graphDot");

  function update(i) {
    const p = graphPts[i];
    if (!p) return;
    graphActiveIndex = i;
    guide.setAttribute("x1", p.x);
    guide.setAttribute("x2", p.x);
    guide.style.display = "";
    dot.setAttribute("cx", p.x);
    dot.setAttribute("cy", p.y);
    dot.style.display = "";

    const copy = daylightReadoutCopy(p, data, chart, uv);
    const activeMemory = graphMemoryAtMs(p.ms, memoryWindows);
    const meta = activeMemory ? `During ${activeMemory.label} · ${copy.meta}` : copy.meta;
    callout.classList.add("is-sun");
    callout.innerHTML =
      `<span class="callout-main">${escapeHtml(copy.time)} · ${escapeHtml(copy.title)}</span><span class="callout-sub">${escapeHtml(meta)}</span>`;

    const wrapWidth = wrap.clientWidth;
    const cw = callout.offsetWidth;
    if (!wrapWidth || !cw) return;
    const px = (p.x / VW) * wrapWidth;
    const minLeft = cw / 2 + 2;
    const maxLeft = Math.max(minLeft, wrapWidth - cw / 2 - 2);
    const left = clamp(px, minLeft, maxLeft);
    const pointerX = clamp(px - (left - cw / 2), 8, cw - 8);
    callout.style.left = `${left}px`;
    callout.style.setProperty("--pointer-x", `${pointerX}px`);
  }
  graphUpdateActive = update;

  function nearest(clientX) {
    const rect = svg.getBoundingClientRect();
    const vbX = ((clientX - rect.left) / rect.width) * VW;
    let best = 0, bd = Infinity;
    graphPts.forEach((p, idx) => {
      const d = Math.abs(p.x - vbX);
      if (d < bd) { bd = d; best = idx; }
    });
    return best;
  }

  svg.addEventListener("pointermove", (e) => update(nearest(e.clientX)));
  svg.addEventListener("pointerdown", (e) => update(nearest(e.clientX)));
  scheduleGraphCalloutReflow();
  perfEnd("drawSunGraph", perf);
}

function nearestGraphSunIndexByMs(ms) {
  if (!graphPts.length) return 0;
  let best = 0, bd = Infinity;
  graphPts.forEach((point, index) => {
    const d = Math.abs(point.ms - ms);
    if (d < bd) { bd = d; best = index; }
  });
  return best;
}

function renderSheetStats(hrs, { sunriseISO, sunsetISO, windUnit, precipUnit }) {
  const maxWind = Math.round(Math.max(...hrs.map((h) => h.wind)));
  const maxGust = Math.round(Math.max(...hrs.map((h) => h.gust)));
  const maxUv = Math.round(Math.max(...hrs.map((h) => h.uv)));
  const totalPrecip = hrs.reduce((sum, h) => sum + h.precip, 0);

  const tiles = [
    { label: "Sunrise", value: sunriseISO ? formatTime(sunriseISO) : "--" },
    { label: "Sunset", value: sunsetISO ? formatTime(sunsetISO) : "--" },
    { label: "UV Peak", value: maxUv },
    { label: "Wind", value: `${maxWind} ${windUnit}` },
    { label: "Gusts", value: `${maxGust} ${windUnit}` },
    { label: "Precip", value: `${formatAmount(totalPrecip)} ${precipUnit}` }
  ];

  document.getElementById("sheetStats").innerHTML = tiles.map((t) => `
    <div class="sheet-stat">
      <span>${t.label}</span>
      <strong>${t.value}</strong>
    </div>
  `).join("");
}
