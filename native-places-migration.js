(function attachPlacesMigrationExport(global) {
  "use strict";

  // This is a read-only rehearsal export, not a storage owner or a migration
  // commit. Only these seven keys may be consulted; storage is never scanned.
  const KEYS = Object.freeze({
    saved: "weather-places",
    last: "weather-last-place",
    unit: "weather-unit",
    theme: "weather-theme",
    clock: "nearcast-time-format",
    sky: "nearcast-reactive-sky-v1",
    motion: "nearcast-reactive-sky-motion-v1"
  });
  const MAX_BYTES = 128 * 1024;
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const fail = () => { throw new Error("Places and preferences could not be prepared safely."); };
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  function text(value, maximum, required = false) {
    // Reject C0/C1 controls, but retain Unicode formatting used by legitimate
    // family names and emoji aliases (for example a zero-width joiner).
    if (typeof value !== "string" || value.length > maximum || (required && !value.trim()) || /[\u0000-\u001f\u007f-\u009f]/.test(value)) fail();
    return value;
  }

  function placeID(value) {
    // Search results arrive from Open-Meteo with numeric GeoNames IDs, and
    // normalizePlace historically preserved their numeric type. Keep its kind
    // for a future compatibility writer instead of losing strict-ID equality.
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || value <= 0) fail();
      return { id: String(value), legacyIDType: "number" };
    }
    return { id: text(value, 160, true) };
  }

  function countryCode(record) {
    let primary;
    let alternate;
    if (has(record, "countryCode")) {
      if (typeof record.countryCode !== "string") fail();
      primary = record.countryCode;
    }
    if (has(record, "country_code")) {
      if (typeof record.country_code !== "string") fail();
      alternate = record.country_code;
    }
    const normalize = (value) => {
      if (value === undefined || value === "") return undefined;
      if (!/^[a-zA-Z]{2}$/.test(value)) fail();
      return value.toUpperCase();
    };
    const a = normalize(primary);
    const b = normalize(alternate);
    if (a && b && a !== b) fail();
    return a || b;
  }

  function place(record) {
    if (!object(record) || !has(record, "id") || !has(record, "name") ||
        !has(record, "latitude") || !has(record, "longitude")) fail();
    const latitude = record.latitude;
    const longitude = record.longitude;
    // Persisted records written by the app already contain numeric coordinates.
    // Do not coerce strings, blanks, booleans or null into a different location.
    if (typeof latitude !== "number" || typeof longitude !== "number" ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) fail();
    const exported = {
      ...placeID(record.id),
      name: text(record.name, 180, true),
      admin1: has(record, "admin1") ? text(record.admin1, 180) : "",
      country: has(record, "country") ? text(record.country, 180) : "",
      latitude,
      longitude
    };
    const code = countryCode(record);
    if (code) exported.countryCode = code;
    if (has(record, "alias")) exported.alias = text(record.alias, 36);
    if (has(record, "timezone")) {
      const zone = text(record.timezone, 100, true);
      // Validate without replacing the saved identifier with a device zone.
      new Intl.DateTimeFormat("en", { timeZone: zone });
      exported.timezone = zone;
    }
    if (has(record, "followsCurrentLocation")) {
      if (typeof record.followsCurrentLocation !== "boolean") fail();
      exported.followsCurrentLocation = record.followsCurrentLocation;
    }
    return exported;
  }

  function qualifier(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ")
      .replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase();
  }

  // Match the app's narrow legacy normalization when checking its hydrated
  // in-memory copy. The export itself retains the validated original record.
  function canonicalName(record) {
    const qualifiers = new Set([record.admin1, record.country].map(qualifier).filter(Boolean));
    const parts = record.name.trim().split(",").map((part) => part.trim()).filter(Boolean);
    while (parts.length > 1 && qualifier(parts.at(-1)) === qualifier(parts.at(-2))) parts.pop();
    while (parts.length > 1 && qualifiers.has(qualifier(parts.at(-1)))) parts.pop();
    return parts.join(", ") || "Selected Place";
  }

  function assertHydratedCopy(raw, hydrated) {
    const statePlace = place(hydrated);
    for (const key of ["id", "legacyIDType", "admin1", "country", "countryCode", "latitude", "longitude", "followsCurrentLocation"]) {
      if (raw[key] !== statePlace[key]) fail();
    }
    if (statePlace.name !== canonicalName(raw)) fail();
    const expectedAlias = (raw.alias || "").replace(/\s+/g, " ").trim();
    if ((statePlace.alias || "") !== expectedAlias) fail();
    // Existing normalizePlace drops timezone. A retained state zone must agree;
    // an absent one does not authorize dropping the original from this export.
    if (has(statePlace, "timezone") && statePlace.timezone !== raw.timezone) fail();
  }

  function preference(raw, allowed, fallback, emptyUsesDefault = false) {
    if (raw === null || (emptyUsesDefault && raw === "")) return fallback;
    if (typeof raw !== "string" || !allowed.includes(raw)) fail();
    return raw;
  }

  function flag(raw) {
    if (raw === null || raw === "0") return false;
    if (raw === "1") return true;
    fail();
  }

  function read(storage, key) {
    const value = storage.getItem(key);
    if (value !== null && typeof value !== "string") fail();
    return value;
  }

  function build(input) {
    try {
      if (!object(input) || input.inventoryReady !== true || !object(input.state) ||
          !object(input.storage) || typeof input.storage.getItem !== "function") fail();
      const { state, storage } = input;
      if (!Array.isArray(state.savedPlaces) || state.savedPlaces.length > 60 || !has(state, "activePlace")) fail();

      // Read only fixed keys. A getItem or JSON failure aborts the entire export,
      // never silently converting an unreadable inventory into an empty one.
      const savedText = read(storage, KEYS.saved);
      const lastText = read(storage, KEYS.last);
      const unitText = read(storage, KEYS.unit);
      const themeText = read(storage, KEYS.theme);
      const clockText = read(storage, KEYS.clock);
      const skyText = read(storage, KEYS.sky);
      const motionText = read(storage, KEYS.motion);
      const rawSaved = savedText === null ? [] : JSON.parse(savedText);
      const rawLast = lastText === null ? null : JSON.parse(lastText);
      if (!Array.isArray(rawSaved) || rawSaved.length > 60 || rawSaved.length !== state.savedPlaces.length) fail();
      const seen = new Set();
      const savedPlaces = rawSaved.map((record, index) => {
        const exported = place(record);
        if (seen.has(exported.id)) fail();
        seen.add(exported.id);
        assertHydratedCopy(exported, state.savedPlaces[index]);
        return exported;
      });
      const preferences = {
        unit: preference(unitText, ["fahrenheit", "celsius"], "fahrenheit", true),
        timeFormat: preference(clockText, ["auto", "12", "24"], "auto"),
        theme: preference(themeText, ["auto", "light", "dark"], "auto", true),
        reactiveSkyEnabled: flag(skyText),
        reactiveSkyMotionAllowed: flag(motionText)
      };
      for (const [key, value] of Object.entries(preferences)) {
        if (!has(state, key) || state[key] !== value) fail();
      }
      const now = new Date(Date.prototype.getTime.call(input.now));
      const capturedAt = now.toISOString();
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(capturedAt)) fail();
      const snapshot = {
        version: 1,
        owner: "legacy",
        hydration: "ready",
        capturedAt,
        selectedPlace: state.activePlace === null ? null : place(state.activePlace),
        lastPlace: rawLast === null ? null : place(rawLast),
        savedPlaces,
        preferences
      };
      if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_BYTES) fail();
      return snapshot;
    } catch {
      // No record contents, storage errors, or private data enter diagnostics.
      return fail();
    }
  }

  global.NearcastPlacesMigrationExport = Object.freeze({ version: 1, build });
})(window);
