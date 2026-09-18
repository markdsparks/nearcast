(function attachNativePlacesOwner(global) {
  "use strict";
  const WATCH_KEY = "nearcast-place-watch-notification-places-v1";
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
    : object(value) ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
  const fail = (code = "storage") => { throw Object.assign(new Error("Places could not be verified. Reopen Places and try again."), { code }); };
  const host = () => global.NearcastNative?.placesOwner;
  let frozen = false;
  let initialized = false;
  let current = null;
  let mutations = Promise.resolve();
  let reconciliation = Promise.resolve();

  function managed() { return frozen || Boolean(host() && host().status !== "unmigrated"); }
  function owned() { return host()?.status === "owned"; }
  function legacyPlace(value) {
    if (value === null) return null;
    if (!object(value)) fail();
    const result = clone(value);
    if (own(result, "legacyIDType")) {
      if (result.legacyIDType !== "number" || !/^[1-9][0-9]*$/.test(result.id) ||
          !Number.isSafeInteger(Number(result.id)) || String(Number(result.id)) !== result.id) fail();
      result.id = Number(result.id);
      delete result.legacyIDType;
    }
    return result;
  }

  function exportPlace(value) {
    const preferences = { unit: "fahrenheit", timeFormat: "auto", theme: "auto", reactiveSkyEnabled: false, reactiveSkyMotionAllowed: false };
    return global.NearcastPlacesMigrationExport.build({ state: { ...preferences, activePlace: value, savedPlaces: [] },
      storage: { getItem: () => null }, inventoryReady: true, now: new Date() }).selectedPlace;
  }

  function validate(snapshot) {
    if (!object(snapshot) || snapshot.version !== 1 || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 ||
        !Number.isSafeInteger(snapshot.deletionWatermark) || snapshot.deletionWatermark < 0 ||
        !Array.isArray(snapshot.pendingDeletions) || snapshot.pendingDeletions.length > 4096) fail();
    const source = snapshot.source;
    if (!object(source) || source.version !== 1 || source.owner !== "native" || source.hydration !== "ready" ||
        typeof source.capturedAt !== "string" || !Number.isFinite(Date.parse(source.capturedAt)) ||
        !Array.isArray(source.savedPlaces) || source.savedPlaces.length > 60 || !object(source.preferences)) fail();
    const ids = new Set();
    for (const place of [source.selectedPlace, source.lastPlace, ...source.savedPlaces]) {
      if (place !== null && canonical(exportPlace(legacyPlace(place))) !== canonical(place)) fail();
    }
    for (const place of source.savedPlaces) { if (ids.has(place.id)) fail(); ids.add(place.id); }
    const prefs = source.preferences;
    if (!["fahrenheit", "celsius"].includes(prefs.unit) || !["auto", "12", "24"].includes(prefs.timeFormat) ||
        !["auto", "light", "dark"].includes(prefs.theme) || typeof prefs.reactiveSkyEnabled !== "boolean" ||
        typeof prefs.reactiveSkyMotionAllowed !== "boolean") fail();
    let sequence = snapshot.deletionWatermark;
    for (const deletion of snapshot.pendingDeletions) {
      if (!object(deletion) || deletion.sequence !== ++sequence || !Number.isSafeInteger(sequence) ||
          typeof deletion.id !== "string" || !deletion.id.trim() || deletion.id.length > 160 || /[\u0000-\u001f\u007f-\u009f]/.test(deletion.id)) fail();
    }
    return clone(snapshot);
  }

  function watchPreferences() {
    const raw = localStorage.getItem(WATCH_KEY);
    if (raw === null) return { enabled: false, selectedIds: [], nativeDeletionWatermark: 0 };
    const value = JSON.parse(raw);
    if (!object(value) || typeof value.enabled !== "boolean" ||
        (own(value, "selectedIds") && (!Array.isArray(value.selectedIds) || value.selectedIds.some((id) => typeof id !== "string" || !id.trim()))) ||
        (own(value, "nativeDeletionWatermark") && (!Number.isSafeInteger(value.nativeDeletionWatermark) || value.nativeDeletionWatermark < 0))) fail();
    return value;
  }

  function persistWatch(value) {
    const text = JSON.stringify({ ...value, updatedAt: new Date().toISOString() });
    localStorage.setItem(WATCH_KEY, text);
    if (localStorage.getItem(WATCH_KEY) !== text) fail();
  }

  function freezeWatchSelection() {
    const preferences = watchPreferences();
    if (!Array.isArray(preferences.selectedIds)) {
      const selectedIds = preferences.enabled ? state.savedPlaces.map((place) => String(place.id).trim()).filter(Boolean).slice(0, 3) : [];
      persistWatch({ ...preferences, selectedIds, nativeDeletionWatermark: preferences.nativeDeletionWatermark || 0 });
    }
  }

  async function prepareActivation() {
    if (!host() || host().status !== "unmigrated" || frozen || !initialized || nativePlacesMigrationInventoryReady !== true) fail("unavailable");
    frozen = true;
    host().compatibleReady = false;
    try {
      if (typeof planWatchInventoryIsKnown !== "function" || !planWatchInventoryIsKnown()) fail("unavailable");
      // Prove the complete legacy inventory before the first preparatory write.
      // A damaged saved record must not even freeze notification intent from
      // its potentially lossy in-memory normalization.
      global.NearcastPlacesMigrationExport.build({ state, storage: localStorage, inventoryReady: true, now: new Date() });
      // Freeze before exporting: reordering/deleting saved places must never
      // change the historical implicit first-three notification choice.
      freezeWatchSelection();
      markPlanWatchSyncDirty();
      return global.NearcastPlacesMigrationExport.build({ state, storage: localStorage, inventoryReady: true, now: new Date() });
    } catch (error) { frozen = false; throw error; }
  }

  function cancelActivation() {
    if (host()?.status !== "unmigrated") return false;
    frozen = false;
    return true;
  }

  async function finishActivation() {
    if (host()?.status === "unmigrated") return cancelActivation();
    if (!owned()) fail("unavailable");
    frozen = false;
    return reconcile();
  }

  function project(snapshot, refresh) {
    if (typeof applyNativePlacesOwnerSource !== "function") return;
    applyNativePlacesOwnerSource(snapshot.source, snapshot.revision, { refresh });
  }

  function bootstrap() {
    if (!owned()) return;
    host().compatibleReady = false;
    current = validate(host().snapshot);
    project(current, false);
  }

  async function reconcileNow() {
    if (!owned()) { if (host()) host().compatibleReady = false; return false; }
    const next = validate(host().snapshot);
    if (current && next.revision < current.revision) fail("stale");
    if (current && next.revision === current.revision && canonical(current) !== canonical(next)) fail("stale");
    const changed = !current || next.revision !== current.revision;
    current = next;
    host().compatibleReady = false;
    if (changed) project(next, initialized);
    if (!initialized || !planWatchInventoryIsKnown()) return false;
    const preferences = watchPreferences();
    // Activation froze implicit selection. An owned installation with missing
    // or malformed intent must not invent a new first-three watch selection.
    if (!Array.isArray(preferences.selectedIds)) fail();
    let watermark = preferences.nativeDeletionWatermark || 0;
    const latestDeletion = next.pendingDeletions.at(-1)?.sequence ?? next.deletionWatermark;
    if (watermark < next.deletionWatermark || watermark > latestDeletion) fail();
    const pending = next.pendingDeletions.filter((deletion) => deletion.sequence > watermark);
    if (pending.length) {
      // Legacy notification identity trims IDs even though native records
      // preserve them verbatim. Use that same identity only for watch cleanup.
      const removed = new Set(pending.map((deletion) => deletion.id.trim()));
      watermark = pending.at(-1).sequence;
      persistWatch({ ...preferences, selectedIds: preferences.selectedIds.filter((id) => !removed.has(id.trim())), nativeDeletionWatermark: watermark });
    }
    // Durable dirty intent precedes ACK, so a crash after ACK cannot lose the
    // subsequent server cleanup. A re-add does not recreate the removed choice.
    if (changed || pending.length) markPlanWatchSyncDirty();
    if (next.pendingDeletions.length && watermark >= next.pendingDeletions[0].sequence) {
      const acknowledged = validate(await host().acknowledgeDeletions(Math.min(watermark, next.pendingDeletions.at(-1).sequence)));
      if (acknowledged.revision < next.revision) fail();
      const latest = validate(host().snapshot);
      if (latest.revision < acknowledged.revision) fail();
      // An unrelated native edit may have completed while ACK awaited I/O.
      // Reconcile that newer generation directly; never project old weather or
      // preferences even briefly from a delayed acknowledgment response.
      if (latest.revision > acknowledged.revision) return reconcileNow();
      if (canonical(latest) !== canonical(acknowledged)) fail();
      current = acknowledged;
      project(acknowledged, initialized);
    }
    if (host().snapshot?.revision !== current.revision || !planWatchInventoryIsKnown()) return false;
    host().compatibleReady = true;
    void syncPlanWatchNotificationSubscription({ force: true, reason: "native-owner-reconciled", preserveGeneration: true });
    return true;
  }

  function reconcile() {
    const work = reconciliation.then(reconcileNow);
    reconciliation = work.catch(() => { if (host()) host().compatibleReady = false; });
    return work;
  }

  function finishInitialization() {
    initialized = true;
    if (owned()) return reconcile();
    return Promise.resolve(false);
  }

  function perform(command) {
    const work = mutations.then(async () => {
      if (!owned() || frozen) fail("unavailable");
      const before = validate(host().snapshot);
      const input = clone(command);
      if (!input.expectedSource && input.action !== "snapshot" && input.action !== "search") input.expectedSource = before.source;
      const reply = await host().perform(input);
      if (!object(reply) || reply.version !== 1 || reply.requestID !== input.requestID || typeof reply.ok !== "boolean") fail();
      await reconcile();
      if (reply.ok && input.action !== "search") {
        if (!reply.source) fail();
        const content = (source) => { const { capturedAt, ...rest } = source; return canonical(rest); };
        // Deletion ACKs may advance only the owner metadata while preserving
        // the successful user edit. Return the latest verified capture then.
        if (content(reply.source) !== content(current.source)) fail("stale");
        return { ...reply, source: clone(current.source) };
      }
      return reply;
    });
    mutations = work.catch(() => undefined);
    return work;
  }

  async function mutate(action, values = {}) {
    const reply = await perform({ version: 1, requestID: crypto.randomUUID(), action, ...values });
    if (!reply.ok) fail(reply.code || "storage");
    return reply.source;
  }

  function matches(place, unit = state.unit) {
    if (!owned() || !current || host().snapshot?.revision !== current.revision) return false;
    const selected = current.source.selectedPlace;
    return Boolean(selected && String(place?.id) === selected.id && place?.latitude === selected.latitude &&
      place?.longitude === selected.longitude && unit === current.source.preferences.unit);
  }

  function widgetRevision(place, data) {
    if (!managed()) return undefined;
    if (!owned() || !host().compatibleReady || !matches(place, state.forecastUnit) ||
        data !== state.forecast || String(state.forecastPlaceId) !== String(place?.id) || host().snapshot?.revision !== current?.revision) return null;
    return current.revision;
  }

  global.addEventListener("nearcast:native-places-owner", () => {
    if (host()) host().compatibleReady = false;
    if (initialized) void reconcile().catch(() => {});
  });
  global.addEventListener("online", () => { if (initialized && owned()) void reconcile().catch(() => {}); });
  global.addEventListener("nearcast:native-notification-status", () => {
    if (!initialized) return;
    if (owned()) void reconcile().catch(() => {});
    else if (!managed()) void syncPlanWatchNotificationSubscription({ force: true, preserveGeneration: true });
  });
  global.NearcastNativePlacesOwner = Object.freeze({ version: 1, managed, owned, bootstrap, finishInitialization,
    prepareActivation, finishActivation, cancelActivation, reconcile, perform, mutate, exportPlace, legacyPlace,
    matches, widgetRevision, current: () => current ? clone(current) : null });
})(window);
