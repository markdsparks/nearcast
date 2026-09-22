// Read-only compatibility adapter for live hosts predating native Agenda export.
// The validation contract is shared with planner.js and tested for drift.
(() => {
  if (window.__nearcastNativeAgendaAdapter) return;
  window.__nearcastNativeAgendaAdapter = true;
/* ---------- Native Agenda export (read-only legacy projection) ---------- */

// The native Agenda reader accepts this versioned wire format only. Keep this
// bridge deliberately narrower than the plan-watch path: saved plan timing is
// useful to native presentation, but notification intent and delivery state are
// not part of that presentation contract.
const LEGACY_AGENDA_EXPORT_VERSION = 1;
const LEGACY_AGENDA_PLAN_SCHEMA_VERSION = 2;
const LEGACY_AGENDA_MAX_PLANS = 60;
const LEGACY_AGENDA_MAX_WINDOWS = 60;
const LEGACY_AGENDA_MAX_PAYLOAD_BYTES = 128 * 1024;
let legacyAgendaMemoryHydrated = false;

function markLegacyAgendaMemoryHydrated() {
  legacyAgendaMemoryHydrated = true;
  publishLegacyAgendaSnapshot();
}

function legacyAgendaIOSBridge() {
  try {
    const bridge = window.NearcastNative;
    return bridge?.platform === "ios" && typeof bridge.postMessage === "function" ? bridge : null;
  } catch {
    return null;
  }
}

function legacyAgendaValidText(value, maximum, required = false) {
  return typeof value === "string" &&
    value.length <= maximum &&
    (!required || value.trim().length > 0) &&
    !/[\u0000-\u001F\u007F-\u009F]/.test(value);
}

function legacyAgendaValidCivilDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function legacyAgendaValidHour(value, isStart) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 24 &&
    Math.abs(value * 3600 - Math.round(value * 3600)) < 0.000001 &&
    (isStart ? value < 24 : value > 0);
}

function legacyAgendaValidTimestamp(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function legacyAgendaValidPlaceIdentifier(value) {
  return (typeof value === "string" && legacyAgendaValidText(value, 160, true)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
}

function legacyAgendaValidTimeZone(value) {
  if (typeof value !== "string" || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function legacyAgendaWirePlace(place) {
  if (!place || typeof place !== "object" || Array.isArray(place) ||
      !legacyAgendaValidPlaceIdentifier(place.id) ||
      !legacyAgendaValidText(place.name, 180, true) ||
      !legacyAgendaValidText(place.admin1, 180) ||
      !legacyAgendaValidText(place.country, 180) ||
      !(place.countryCode === "" || (typeof place.countryCode === "string" && /^[A-Z]{2}$/.test(place.countryCode))) ||
      typeof place.latitude !== "number" || !Number.isFinite(place.latitude) || Math.abs(place.latitude) > 90 ||
      typeof place.longitude !== "number" || !Number.isFinite(place.longitude) || Math.abs(place.longitude) > 180 ||
      (place.alias !== undefined && !legacyAgendaValidText(place.alias, 36)) ||
      (place.timezone !== undefined && !legacyAgendaValidTimeZone(place.timezone)) ||
      (place.followsCurrentLocation !== undefined && typeof place.followsCurrentLocation !== "boolean")) return null;

  const wire = {
    id: place.id,
    name: place.name,
    admin1: place.admin1,
    country: place.country,
    countryCode: place.countryCode,
    latitude: place.latitude,
    longitude: place.longitude
  };
  if (place.alias !== undefined) wire.alias = place.alias;
  if (place.timezone !== undefined) wire.timezone = place.timezone;
  if (place.followsCurrentLocation !== undefined) wire.followsCurrentLocation = place.followsCurrentLocation;
  return wire;
}

function legacyAgendaWireWindow(window) {
  if (!window || typeof window !== "object" || Array.isArray(window) ||
      !legacyAgendaValidText(window.id, 160, true) ||
      !legacyAgendaValidCivilDate(window.targetDate) ||
      !legacyAgendaValidHour(window.startHour, true) ||
      !legacyAgendaValidHour(window.endHour, false) ||
      window.endHour <= window.startHour ||
      !legacyAgendaValidText(window.label, 80, true)) return null;
  return {
    id: window.id,
    targetDate: window.targetDate,
    startHour: window.startHour,
    endHour: window.endHour,
    label: window.label
  };
}

function legacyAgendaWireSpan(span) {
  if (!span || typeof span !== "object" || Array.isArray(span) ||
      !legacyAgendaValidCivilDate(span.startDate) ||
      !legacyAgendaValidCivilDate(span.endDate) ||
      span.startDate > span.endDate ||
      !legacyAgendaValidHour(span.startHour, true) ||
      !legacyAgendaValidHour(span.endHour, false) ||
      (span.startDate === span.endDate && span.endHour <= span.startHour)) return null;
  const start = new Date(`${span.startDate}T00:00:00.000Z`);
  const end = new Date(`${span.endDate}T00:00:00.000Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (!Number.isInteger(days) || days < 0 || days > 13) return null;
  return {
    startDate: span.startDate,
    startHour: span.startHour,
    endDate: span.endDate,
    endHour: span.endHour
  };
}

function legacyAgendaWireRoutine(routine) {
  if (!routine || typeof routine !== "object" || Array.isArray(routine) ||
      routine.frequency !== "weekly" || !Array.isArray(routine.weekdays) ||
      !routine.weekdays.length || routine.weekdays.length > 7 ||
      !routine.weekdays.every((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) ||
      JSON.stringify(routine.weekdays) !== JSON.stringify([...new Set(routine.weekdays)].sort((a, b) => a - b)) ||
      routine.weekday !== routine.weekdays[0] || !Array.isArray(routine.focus) ||
      routine.focus.length > 3 || [...new Set(routine.focus)].length !== routine.focus.length ||
      !routine.focus.every((focus) => ["rain", "wind", "heat"].includes(focus))) return null;
  return {
    frequency: "weekly",
    weekdays: [...routine.weekdays],
    weekday: routine.weekday,
    focus: [...routine.focus]
  };
}

function legacyAgendaExpectedSpanWindows(span) {
  const windows = [];
  for (let date = span.startDate, index = 0; date && date <= span.endDate && index <= 13; date = planIsoDateOffset(date, 1), index += 1) {
    const first = date === span.startDate;
    const last = date === span.endDate;
    windows.push({
      id: `span-${date}`,
      targetDate: date,
      startHour: first ? span.startHour : 0,
      endHour: last ? span.endHour : 24,
      label: first ? "Starts" : (last ? "Ends" : "All day")
    });
    if (last) break;
  }
  return windows;
}

function legacyAgendaWindowsMatch(left, right) {
  return left.length === right.length && left.every((window, index) => {
    const expected = right[index];
    return window.id === expected.id && window.targetDate === expected.targetDate &&
      window.startHour === expected.startHour && window.endHour === expected.endHour && window.label === expected.label;
  });
}

function legacyAgendaSourcePlanIsKnown(raw, normalized) {
  // Do not use a normalizer-generated ID, time stamp, schedule shape, or a
  // future schema as if it were an explicitly saved legacy record.
  const rawPlace = legacyAgendaWirePlace(raw?.place);
  const normalizedPlace = legacyAgendaWirePlace(normalized?.place);
  const rawWindows = Array.isArray(raw?.windows) ? raw.windows.map(legacyAgendaWireWindow) : [];
  const normalizedWindows = Array.isArray(normalized?.windows) ? normalized.windows.map(legacyAgendaWireWindow) : [];
  const rawSpan = raw?.span == null ? null : legacyAgendaWireSpan(raw.span);
  const normalizedSpan = normalized?.span == null ? null : legacyAgendaWireSpan(normalized.span);
  const rawRoutine = raw?.routine == null ? null : legacyAgendaWireRoutine(raw.routine);
  const normalizedRoutine = normalized?.routine == null ? null : legacyAgendaWireRoutine(normalized.routine);
  return raw && typeof raw === "object" && !Array.isArray(raw) &&
    raw.kind === "plan" && raw.schemaVersion === LEGACY_AGENDA_PLAN_SCHEMA_VERSION &&
    legacyAgendaValidPlaceIdentifier(raw.id) && String(raw.id) === normalized.id &&
    legacyAgendaValidTimestamp(raw.createdAt) && raw.createdAt === normalized.createdAt &&
    legacyAgendaValidTimestamp(raw.updatedAt) && raw.updatedAt === normalized.updatedAt &&
    ["single", "discrete", "continuous_span"].includes(raw.scheduleType) && raw.scheduleType === normalized.scheduleType &&
    Array.isArray(raw.windows) && raw.windows.length > 0 && raw.windows.length <= LEGACY_AGENDA_MAX_WINDOWS &&
    rawPlace && normalizedPlace && JSON.stringify(rawPlace) === JSON.stringify(normalizedPlace) &&
    !rawWindows.some((window) => !window) && !normalizedWindows.some((window) => !window) &&
    legacyAgendaWindowsMatch(rawWindows, normalizedWindows) &&
    (raw.span == null ? normalizedSpan === null : rawSpan && normalizedSpan && JSON.stringify(rawSpan) === JSON.stringify(normalizedSpan)) &&
    (raw.routine == null ? normalizedRoutine === null : rawRoutine && normalizedRoutine && JSON.stringify(rawRoutine) === JSON.stringify(normalizedRoutine));
}

function legacyAgendaWirePlan(raw) {
  let normalized;
  try {
    normalized = normalizePlanMemory(raw);
  } catch {
    return null;
  }
  if (!normalized || !legacyAgendaSourcePlanIsKnown(raw, normalized) ||
      normalized.schemaVersion !== LEGACY_AGENDA_PLAN_SCHEMA_VERSION ||
      !legacyAgendaValidText(normalized.id, 160, true) ||
      !legacyAgendaValidText(normalized.title, 80, true) ||
      !legacyAgendaValidText(normalized.label, 80, true) ||
      !legacyAgendaValidText(normalized.original, 220) ||
      !legacyAgendaValidText(normalized.answer, 280) ||
      !legacyAgendaValidCivilDate(normalized.targetDate) ||
      !legacyAgendaValidHour(normalized.startHour, true) ||
      !legacyAgendaValidHour(normalized.endHour, false) ||
      normalized.endHour <= normalized.startHour ||
      !legacyAgendaValidText(normalized.scheduleId, 160, true) ||
      !legacyAgendaValidTimestamp(normalized.createdAt) ||
      !legacyAgendaValidTimestamp(normalized.updatedAt) ||
      !Array.isArray(normalized.windows) || !normalized.windows.length || normalized.windows.length > LEGACY_AGENDA_MAX_WINDOWS) return null;

  const place = legacyAgendaWirePlace(normalized.place);
  const windows = normalized.windows.map(legacyAgendaWireWindow);
  if (!place || windows.some((window) => !window) || new Set(windows.map((window) => window.id)).size !== windows.length) return null;
  const first = windows[0];
  if (first.targetDate !== normalized.targetDate || first.startHour !== normalized.startHour || first.endHour !== normalized.endHour) return null;

  const span = normalized.span === null ? null : legacyAgendaWireSpan(normalized.span);
  const routine = normalized.routine === null ? null : legacyAgendaWireRoutine(normalized.routine);
  if ((normalized.span !== null && !span) || (normalized.routine !== null && !routine)) return null;

  if (normalized.scheduleType === "single") {
    if (span || windows.length !== 1) return null;
  } else if (normalized.scheduleType === "discrete") {
    if (span || routine || windows.length < 2) return null;
  } else if (normalized.scheduleType === "continuous_span") {
    if (!span || routine || span.startDate !== normalized.targetDate || span.startHour !== normalized.startHour ||
        !legacyAgendaWindowsMatch(windows, legacyAgendaExpectedSpanWindows(span))) return null;
  } else {
    return null;
  }

  return {
    id: normalized.id,
    kind: "plan",
    title: normalized.title,
    label: normalized.label,
    original: normalized.original,
    answer: normalized.answer,
    place,
    targetDate: normalized.targetDate,
    startHour: normalized.startHour,
    endHour: normalized.endHour,
    windows,
    scheduleType: normalized.scheduleType,
    span,
    routine,
    schemaVersion: LEGACY_AGENDA_PLAN_SCHEMA_VERSION,
    scheduleId: normalized.scheduleId,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt
  };
}

function legacyAgendaSnapshotFromStorage() {
  let rawText;
  try {
    rawText = localStorage.getItem(PLAN_MEMORY_KEY);
  } catch {
    return null;
  }
  // A missing record is unavailable, not an authoritative empty Agenda.
  if (typeof rawText !== "string") return null;

  let rawPlans;
  try {
    rawPlans = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!Array.isArray(rawPlans) || rawPlans.length > LEGACY_AGENDA_MAX_PLANS) return null;

  let plans;
  try {
    plans = rawPlans.map(legacyAgendaWirePlan);
  } catch {
    return null;
  }
  if (plans.some((plan) => !plan) || new Set(plans.map((plan) => plan.id)).size !== plans.length) return null;
  return {
    version: LEGACY_AGENDA_EXPORT_VERSION,
    owner: "legacy",
    hydration: "ready",
    capturedAt: new Date().toISOString(),
    plans
  };
}

function legacyAgendaPayloadFits(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= LEGACY_AGENDA_MAX_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

function publishLegacyAgendaSnapshot() {
  if (!legacyAgendaMemoryHydrated) return false;
  const bridge = legacyAgendaIOSBridge();
  if (!bridge) return false;
  const agenda = legacyAgendaSnapshotFromStorage();
  if (!agenda || !legacyAgendaPayloadFits(agenda)) return false;
  try {
    bridge.postMessage({ type: "agenda.snapshot", agenda });
    return true;
  } catch {
    return false;
  }
}


  markLegacyAgendaMemoryHydrated();
  const originalSave = savePlanMemories;
  savePlanMemories = function(...args) {
    const result = originalSave.apply(this, args);
    publishLegacyAgendaSnapshot();
    return result;
  };
})();
