(function attachNativePlacesControls(global) {
  "use strict";

  // Phase 2B1 is a typed client of the existing app, not a second data owner.
  // Native receives a read-back receipt; only existing web paths publish weather
  // or synchronize already-selected notification targets.
  const actions = new Set(["snapshot", "search", "select", "save", "rename", "move", "remove", "preferences", "currentLocation"]);
  const fields = {
    snapshot: [], search: ["query"], select: ["place", "id"], save: ["place"],
    rename: ["id", "alias"], move: ["id", "direction"], remove: ["id"],
    preferences: ["preferences"], currentLocation: []
  };
  const receipts = new Map();
  let serial = Promise.resolve();
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const fail = (code = "invalid") => { throw Object.assign(new Error("Native places command failed."), { code }); };
  const messages = {
    invalid: "This action could not be understood. Reopen Places and try again.",
    unavailable: "Places are not ready. Return to the existing app and try again.",
    stale: "Places or settings changed. Review the refreshed list and try again.",
    limit: "You can save eight places. Remove a saved place before adding another.",
    location: "Could not get your current location. Search for a place or try again.",
    forecast: "Could not finish loading that forecast. Review the selected place before trying again.",
    storage: "Some changes may have been saved. Review the refreshed places and settings before trying again.",
    search: "Could not search places. Check your connection and try again.",
    busy: "Reopen Places before making more changes."
  };

  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }

  function content(source) {
    const { capturedAt, ...rest } = source;
    return canonical(rest);
  }

  function text(value, limit, required = true) {
    if (typeof value !== "string" || value.length > limit || (required && !value.trim()) || /[\u0000-\u001f\u007f-\u009f]/.test(value)) fail();
    return value;
  }

  function ready() {
    if (global.NearcastNative?.preview?.controlsVersion !== 1 ||
        global.NearcastPlacesMigrationExport?.version !== 1 ||
        typeof nativePlacesMigrationInventoryReady === "undefined" || nativePlacesMigrationInventoryReady !== true) fail("unavailable");
  }

  function snapshot() {
    if (global.NearcastNativePlacesOwner?.owned()) return JSON.parse(JSON.stringify(global.NearcastNative.placesOwner.snapshot.source));
    ready();
    try {
      return global.NearcastPlacesMigrationExport.build({ state, storage: localStorage, inventoryReady: true, now: new Date() });
    } catch { return fail("storage"); }
  }

  function exportPlace(raw) {
    // Use the same production validator/ID representation as migration. A tiny
    // synthetic read-only inventory never touches the family's browser records.
    const preferences = { unit: "fahrenheit", theme: "auto", timeFormat: "auto", reactiveSkyEnabled: false, reactiveSkyMotionAllowed: false };
    return global.NearcastPlacesMigrationExport.build({
      state: { ...preferences, activePlace: raw, savedPlaces: [] },
      storage: { getItem: () => null }, inventoryReady: true, now: new Date()
    }).selectedPlace;
  }

  function decodePlace(value) {
    const allowed = ["id", "legacyIDType", "name", "admin1", "country", "countryCode", "latitude", "longitude", "alias", "timezone", "followsCurrentLocation"];
    if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail();
    text(value.id, 160);
    const raw = { ...value };
    if (own(raw, "legacyIDType")) {
      if (raw.legacyIDType !== "number" || !/^[1-9][0-9]*$/.test(raw.id) ||
          !Number.isSafeInteger(Number(raw.id)) || String(Number(raw.id)) !== raw.id) fail();
      raw.id = Number(raw.id);
      delete raw.legacyIDType;
    }
    let exported;
    try { exported = exportPlace(raw); } catch { return fail(); }
    if (canonical(exported) !== canonical(value)) fail();
    return raw;
  }

  function validate(command) {
    if (!object(command) || command.version !== 1 || !actions.has(command.action) ||
        typeof command.requestID !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.requestID)) fail();
    const allowed = ["version", "requestID", "action", "expectedSource", ...fields[command.action]];
    if (Object.keys(command).some((key) => !allowed.includes(key))) fail();
    if (new TextEncoder().encode(JSON.stringify(command)).byteLength > 280 * 1024) fail();
    if (command.action !== "snapshot" && command.action !== "search" && !object(command.expectedSource)) fail();
    if (own(command, "id")) text(command.id, 160);
    if (own(command, "place")) decodePlace(command.place);
    if (command.action === "select" && (own(command, "id") === own(command, "place"))) fail();
    if (["rename", "move", "remove"].includes(command.action) && !own(command, "id")) fail();
    if (command.action === "save" && !own(command, "place")) fail();
    if (command.action === "rename") text(command.alias, 36, false);
    if (command.action === "move" && ![-1, 1].includes(command.direction)) fail();
    if (command.action === "search") text(command.query, 160);
    if (command.action === "preferences") {
      const values = command.preferences;
      const options = { unit: ["fahrenheit", "celsius"], timeFormat: ["auto", "12", "24"], theme: ["auto", "light", "dark"] };
      if (!object(values) || !Object.keys(values).length || Object.entries(values).some(([key, value]) => !options[key]?.includes(value))) fail();
    }
  }

  function assertFresh(command) {
    const current = snapshot();
    if (content(current) !== content(command.expectedSource)) fail("stale");
    return current;
  }

  function savedRecord(id) {
    const matches = state.savedPlaces.filter((place) => String(place.id) === id);
    if (matches.length !== 1) fail("stale");
    return matches[0];
  }

  function freezeLegacyWatchSelection() {
    if (typeof readPlaceWatchNotificationPlaces !== "function" || typeof placeWatchNotificationSelectedIds !== "function" ||
        typeof writePlaceWatchNotificationPlaces !== "function") fail("unavailable");
    // The existing display helper treats malformed storage as disabled. That is
    // not safe evidence of notification intent during an edit.
    const raw = localStorage.getItem("nearcast-place-watch-notification-places-v1");
    if (raw !== null) {
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return fail("storage"); }
      if (!object(parsed) || typeof parsed.enabled !== "boolean" ||
          (own(parsed, "selectedIds") && (!Array.isArray(parsed.selectedIds) || parsed.selectedIds.some((id) => typeof id !== "string")))) fail("storage");
    }
    const previous = readPlaceWatchNotificationPlaces();
    if (!previous.enabled || previous.hasExplicitSelection) return;
    const selectedIds = placeWatchNotificationSelectedIds();
    writePlaceWatchNotificationPlaces({ enabled: true, selectedIds });
    const verified = readPlaceWatchNotificationPlaces();
    if (!verified.enabled || !verified.hasExplicitSelection || canonical(verified.selectedIds) !== canonical(selectedIds)) fail("storage");
  }

  function verifyRemovedWatch(id) {
    const preferences = readPlaceWatchNotificationPlaces();
    if (preferences.hasExplicitSelection && preferences.selectedIds.includes(id)) fail("storage");
  }

  function prepareRemovedWatch(id) {
    const previous = readPlaceWatchNotificationPlaces();
    if (!previous.hasExplicitSelection || !previous.selectedIds.includes(id)) return;
    const selectedIds = cleanPlaceWatchSelectedIds(previous.selectedIds.filter((selected) => selected !== id), { filterSaved: true });
    // Persist the explicit stop-watch intent before deleting its saved record.
    // Otherwise a swallowed preference-write failure could leave a latent ID
    // that silently starts notifying again when that place is re-added later.
    writePlaceWatchNotificationPlaces({ enabled: previous.enabled, selectedIds });
    const verified = readPlaceWatchNotificationPlaces();
    if (verified.enabled !== previous.enabled || !verified.hasExplicitSelection ||
        canonical(verified.selectedIds) !== canonical(selectedIds)) fail("storage");
  }

  function dismissLegacyWeatherDetails() {
    if (typeof document === "undefined") return;
    const day = document.getElementById("dayDetail");
    if (day && !day.hidden && typeof closeDayDetail === "function") {
      // A prior plan/hourly drill-in must not reopen itself after a place or
      // unit change. This is only presentation state, never saved plan memory.
      if (typeof plannerReturnAfterDayDetail !== "undefined") plannerReturnAfterDayDetail = null;
      closeDayDetail();
    }
    // Close the day first: exiting the map can otherwise restore its suspended
    // day sheet and render an old place's values with the newly selected units.
    if (typeof mapState !== "undefined" && mapState.immersive && typeof exitImmersiveMap === "function") exitImmersiveMap();
    if (typeof els !== "undefined") {
      if (els.glanceDetailSheet && !els.glanceDetailSheet.hidden && typeof closeGlanceDetail === "function") closeGlanceDetail();
      if (els.forecastReceiptSheet && !els.forecastReceiptSheet.hidden && typeof closeForecastReceipt === "function") closeForecastReceipt();
    }
    const alerts = document.getElementById("alertSheet");
    if (alerts && !alerts.hidden && typeof closeAlertSheet === "function") closeAlertSheet({ restoreFocus: false });
  }

  async function search(query) {
    const parsed = parseLocationQuery(query.trim());
    let expired = false;
    let timer;
    const work = async () => {
      let results = [];
      for (const attempt of buildPlaceSearchAttempts(parsed)) {
        if (expired) fail("search");
        results = await fetchPlaceResults(attempt.name, 12, attempt);
        // The shared search helper cannot be canceled here. After timeout its
        // eventual response is ignored and must not start another fallback.
        if (expired) fail("search");
        if (results.length) break;
      }
      ready();
      return rankPlaceResults(results, parsed).slice(0, 8).map((result) => exportPlace(normalizePlace(result)));
    };
    try {
      // Bound the whole search, not each attempt, so a stalled provider cannot
      // indefinitely hold the serialized edit queue. Promise.race observes late
      // rejection as well as resolution; neither can replace the returned reply.
      return await Promise.race([
        work(),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(Object.assign(new Error("Place search unavailable"), { code: "search" }));
          }, 12000);
        })
      ]);
    } catch { return fail("search"); }
    finally { clearTimeout(timer); }
  }

  async function currentLocation(command) {
    if (!navigator.geolocation) fail("location");
    // Unlike the background convenience helper, an explicit selection must not
    // silently fall back to a previously cached coordinate after denial/failure.
    const coordinates = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error("Location unavailable"), { code: "location" })), 12000);
      navigator.geolocation.getCurrentPosition(
        (position) => { clearTimeout(timer); resolve(position.coords); },
        () => { clearTimeout(timer); reject(Object.assign(new Error("Location unavailable"), { code: "location" })); },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
      );
    });
    const fallback = placeFromCoordinates(coordinates);
    let place = fallback;
    try { place = await reverseGeocodePlace(coordinates, fallback); } catch { /* Honest coordinate fallback. */ }
    assertFresh(command);
    // Validate before persisting even when a platform callback is malformed.
    exportPlace(place);
    persistDeviceLocation(coordinates, "gps");
    return place;
  }

  async function execute(command) {
    ready();
    if (command.action === "snapshot") return { source: snapshot() };
    if (command.action === "search") {
      const results = await search(command.query);
      return { source: snapshot(), results };
    }
    const before = assertFresh(command);
    let expectedSelected = null;
    switch (command.action) {
      case "select":
      case "currentLocation": {
        const place = command.action === "currentLocation" ? await currentLocation(command)
          : command.id ? savedRecord(command.id) : decodePlace(command.place);
        expectedSelected = normalizePlace(place);
        try { await loadPlace(place); }
        finally {
          const actual = state.activePlace;
          if (String(actual?.id ?? "") !== (before.selectedPlace?.id ?? "") ||
              actual?.latitude !== before.selectedPlace?.latitude || actual?.longitude !== before.selectedPlace?.longitude) dismissLegacyWeatherDetails();
        }
        if (!nativePreviewForecastMatches(expectedSelected)) fail("forecast");
        break;
      }
      case "save": {
        const place = decodePlace(command.place);
        const existing = state.savedPlaces.find((saved) => String(saved.id) === String(place.id));
        if (existing) {
          if (existing.id !== place.id || existing.latitude !== place.latitude || existing.longitude !== place.longitude) fail("stale");
          break;
        }
        if (state.savedPlaces.length >= 8) fail("limit");
        freezeLegacyWatchSelection();
        await savePlace(place);
        break;
      }
      case "rename": {
        const place = savedRecord(command.id);
        await renameSavedPlace(place.id, command.alias);
        break;
      }
      case "move": {
        const place = savedRecord(command.id);
        freezeLegacyWatchSelection();
        await moveSavedPlace(place.id, command.direction);
        break;
      }
      case "remove": {
        const place = savedRecord(command.id);
        freezeLegacyWatchSelection();
        prepareRemovedWatch(command.id);
        await removeSavedPlace(place.id);
        verifyRemovedWatch(command.id);
        break;
      }
      case "preferences": {
        const preferences = command.preferences;
        if (own(preferences, "unit")) {
          try { await setUnitPreference(preferences.unit); }
          finally {
            // Do this before clock/theme refreshes: those use global units and
            // must never relabel a retained old-place hourly dataset.
            if (state.unit !== before.preferences.unit) dismissLegacyWeatherDetails();
          }
        }
        if (own(preferences, "timeFormat")) await setTimeFormatPreference(preferences.timeFormat);
        if (own(preferences, "theme")) await setThemePreference(preferences.theme);
        break;
      }
    }
    const source = snapshot();
    // A best-effort legacy persistence path must never be mistaken for a commit.
    if (expectedSelected && (source.lastPlace?.id !== String(expectedSelected.id) ||
        source.lastPlace.latitude !== expectedSelected.latitude || source.lastPlace.longitude !== expectedSelected.longitude)) fail("storage");
    if (command.action === "save" && !source.savedPlaces.some((place) => place.id === command.place.id &&
        (before.savedPlaces.some((existing) => existing.id === place.id) || place.followsCurrentLocation === false))) fail("storage");
    if (command.action === "remove" && source.savedPlaces.some((place) => place.id === command.id)) fail("storage");
    if (command.action === "rename") {
      const alias = normalizedPlaceAlias(command.alias);
      if (source.savedPlaces.find((place) => place.id === command.id)?.alias !== alias ||
          (source.lastPlace?.id === command.id && source.lastPlace.alias !== alias)) fail("storage");
    }
    if (command.action === "move") {
      const ids = before.savedPlaces.map((place) => place.id);
      const from = ids.indexOf(command.id), to = from + command.direction;
      if (to >= 0 && to < ids.length) [ids[from], ids[to]] = [ids[to], ids[from]];
      if (canonical(source.savedPlaces.map((place) => place.id)) !== canonical(ids)) fail("storage");
    }
    if (command.action === "preferences" && Object.entries(command.preferences).some(([key, value]) => source.preferences[key] !== value)) fail("storage");
    return { source };
  }

  function errorReply(requestID, error) {
    const code = own(messages, error?.code) ? error.code : "storage";
    const result = { version: 1, requestID, ok: false, code, message: messages[code] };
    // Read current persisted state again. Never roll back by replaying an old
    // native copy, and never claim that a failed multi-setting edit did nothing.
    try { result.source = snapshot(); } catch { /* Unknown is not an empty list. */ }
    return result;
  }

  function perform(input) {
    if (global.NearcastNativePlacesOwner?.managed()) {
      return global.NearcastNativePlacesOwner.perform(input).catch((error) => errorReply(input?.requestID || "", error));
    }
    let command;
    let requestID = typeof input?.requestID === "string" ? input.requestID : "";
    try {
      ready();
      validate(input);
      command = JSON.parse(JSON.stringify(input));
      requestID = command.requestID;
    } catch (error) { return Promise.resolve(errorReply(requestID, error)); }
    const fingerprint = canonical(command);
    const prior = receipts.get(requestID);
    if (prior) return prior.fingerprint === fingerprint ? prior.promise : Promise.resolve(errorReply(requestID, { code: "invalid" }));
    // Do not evict request IDs and accidentally replay an uncertain old write.
    if (receipts.size >= 2048) return Promise.resolve(errorReply(requestID, { code: "busy" }));
    const promise = serial.then(async () => {
      try { return { version: 1, requestID, ok: true, ...await execute(command) }; }
      catch (error) { return errorReply(requestID, error); }
    });
    serial = promise.then(() => undefined);
    receipts.set(requestID, { fingerprint, promise });
    return promise;
  }

  function openExistingSettings() {
    ready();
    // Closing the plan editor discards its unsaved edit state. Leave it intact
    // and let the user finish/cancel deliberately rather than hiding that loss.
    if (typeof els !== "undefined" && els.memoryEditSheet && !els.memoryEditSheet.hidden) return false;
    dismissLegacyWeatherDetails();
    if (typeof els !== "undefined") {
      if (els.placeSheet && !els.placeSheet.hidden && typeof closePlaceSheet === "function") closePlaceSheet();
      if (els.memoryDetailSheet && !els.memoryDetailSheet.hidden && typeof closeMemoryDetail === "function") closeMemoryDetail();
      if (els.memorySheet && !els.memorySheet.hidden && typeof closeGlobalMemorySheet === "function") closeGlobalMemorySheet();
      // The existing Ask close operation retains its input, transcript and plan
      // draft, unlike closing the structured plan editor above.
      if (els.aiSheet && !els.aiSheet.hidden && typeof closeAISheet === "function") closeAISheet({ restoreFocus: false });
    }
    if (typeof toggleSearch === "function") toggleSearch(false);
    if (typeof document !== "undefined") document.body.style.overflow = "";
    if (typeof scrollForecastToTop === "function") scrollForecastToTop();
    toggleAppMenu(true);
    return true;
  }

  global.NearcastPlacesControls = Object.freeze({ version: 1, perform, openExistingSettings });
})(window);
