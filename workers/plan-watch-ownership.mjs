// Pure, unused foundation for the future Plan Watch delivery-owner transfer.
//
// This module is intentionally *not* imported by radar-capability.mjs, does
// not define a Worker route, and has no storage, networking, APNs, evaluator,
// secret, or capability implementation. It gives the eventual server-side
// coordinator one narrowly testable state machine before any live delivery
// code is allowed to depend on it.
//
// Opaque fingerprints stand in for future signed tickets/capabilities. Their
// values are never interpreted here: the model only compares them exactly.

export const PLAN_WATCH_OWNERSHIP_VERSION = 1;
export const PLAN_WATCH_OWNERSHIP_STATES = Object.freeze({
  legacyOwned: "legacy-owned",
  nativeTransferPending: "native-transfer-pending",
  nativeOwned: "native-owned",
  recoveryNeeded: "recovery-needed"
});

const MAX_OPAQUE_BYTES = 64 * 1024;
const MAX_TICKET_TTL_MS = 15 * 60 * 1000;
const MAX_TICKET_TOMBSTONES = 8;
const MAX_EPOCH = Number.MAX_SAFE_INTEGER - 1;
const stateNames = new Set(Object.values(PLAN_WATCH_OWNERSHIP_STATES));
// The production coordinator will replace these with signed, scoped
// capabilities. Requiring a named opaque digest format here keeps plain
// identifiers and accidental payloads out of this pure protocol boundary.
const fingerprintPattern = /^sha256:[A-Za-z0-9_-]{16,128}$/;

function failure(reason) {
  return { ok: false, reason };
}

function success(state, extra = {}) {
  return { ok: true, state: clone(state), ...extra };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function validFingerprint(value) {
  return typeof value === "string" && fingerprintPattern.test(value);
}

function validEpoch(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_EPOCH;
}

function validTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Baseline and dedupe metadata are deliberately opaque. The protocol retains
// their JSON bytes/shape but never derives a notification decision from them.
function validOpaqueMetadata(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return Object.keys(value).length === value.length && value.every(validOpaqueMetadata);
  if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  if (!Object.values(value).every(validOpaqueMetadata)) return false;
  try {
    return JSON.stringify(value).length <= MAX_OPAQUE_BYTES;
  } catch {
    return false;
  }
}

function validLegacy(value) {
  return exactKeys(value, ["subscriptionFingerprint", "intentFingerprint"]) &&
    validFingerprint(value.subscriptionFingerprint) && validFingerprint(value.intentFingerprint);
}

function validOpaque(value) {
  return exactKeys(value, ["baselineMetadata", "dedupeMetadata"]) &&
    validOpaqueMetadata(value.baselineMetadata) && validOpaqueMetadata(value.dedupeMetadata);
}

function validPending(value) {
  return exactKeys(value, [
    "ticketId", "ticketFingerprint", "expectedOwnerEpoch", "issuedAtMs", "expiresAtMs", "intentFingerprint", "prepared"
  ]) && validFingerprint(value.ticketId) && validFingerprint(value.ticketFingerprint) &&
    validEpoch(value.expectedOwnerEpoch) && validTimestamp(value.issuedAtMs) && validTimestamp(value.expiresAtMs) &&
    value.expiresAtMs > value.issuedAtMs && value.expiresAtMs - value.issuedAtMs <= MAX_TICKET_TTL_MS &&
    validFingerprint(value.intentFingerprint) &&
    (value.prepared === null || validPreparedBinding(value.prepared));
}

function validTransfer(value) {
  return exactKeys(value, [
    "transferId", "ticketId", "ticketFingerprint", "preparedAtMs", "committedAtMs", "previousOwnerEpoch", "intentFingerprint"
  ]) && validFingerprint(value.transferId) && validFingerprint(value.ticketId) && validFingerprint(value.ticketFingerprint) &&
    validTimestamp(value.preparedAtMs) && validTimestamp(value.committedAtMs) && value.committedAtMs >= value.preparedAtMs &&
    validEpoch(value.previousOwnerEpoch) && validFingerprint(value.intentFingerprint);
}

function validNative(value) {
  return exactKeys(value, ["ownerFingerprint", "channelFingerprint", "intentFingerprint"]) &&
    validFingerprint(value.ownerFingerprint) && validFingerprint(value.channelFingerprint) &&
    validFingerprint(value.intentFingerprint);
}

function validRecovery(value) {
  return exactKeys(value, ["reasonFingerprint", "enteredAtMs", "priorOwnerEpoch"]) &&
    validFingerprint(value.reasonFingerprint) && validTimestamp(value.enteredAtMs) && validEpoch(value.priorOwnerEpoch);
}

function validTicketTombstone(value) {
  return exactKeys(value, ["ticketId", "ticketFingerprint", "retiredAtMs", "reason"]) &&
    validFingerprint(value.ticketId) && validFingerprint(value.ticketFingerprint) && validTimestamp(value.retiredAtMs) &&
    ["cancelled", "committed", "expired"].includes(value.reason);
}

function validTicketTombstones(value) {
  if (!Array.isArray(value) || value.length > MAX_TICKET_TOMBSTONES || !value.every(validTicketTombstone)) return false;
  const ticketIds = new Set();
  const fingerprints = new Set();
  return value.every(tombstone => {
    if (ticketIds.has(tombstone.ticketId) || fingerprints.has(tombstone.ticketFingerprint)) return false;
    ticketIds.add(tombstone.ticketId);
    fingerprints.add(tombstone.ticketFingerprint);
    return true;
  });
}

function hasCommittedTicketTombstone(tombstones, transfer) {
  return tombstones.some(tombstone => tombstone.ticketId === transfer.ticketId &&
    tombstone.ticketFingerprint === transfer.ticketFingerprint &&
    tombstone.retiredAtMs === transfer.committedAtMs && tombstone.reason === "committed");
}

function validState(value) {
  if (!exactKeys(value, [
    "version", "state", "ownerEpoch", "legacy", "opaque", "ticketTombstones", "pending", "transfer", "native", "recovery"
  ]) ||
      value.version !== PLAN_WATCH_OWNERSHIP_VERSION || !stateNames.has(value.state) || !validEpoch(value.ownerEpoch) ||
      !validLegacy(value.legacy) || !validOpaque(value.opaque) || !validTicketTombstones(value.ticketTombstones)) {
    return false;
  }
  switch (value.state) {
  case PLAN_WATCH_OWNERSHIP_STATES.legacyOwned:
    return value.pending === null && value.transfer === null && value.native === null && value.recovery === null;
  case PLAN_WATCH_OWNERSHIP_STATES.nativeTransferPending:
    return validPending(value.pending) && value.pending.expectedOwnerEpoch === value.ownerEpoch &&
      value.pending.intentFingerprint === value.legacy.intentFingerprint &&
      !ticketWasRetired(value.ticketTombstones, value.pending.ticketId, value.pending.ticketFingerprint) &&
      (value.pending.prepared === null || (
        value.pending.prepared.expectedOwnerEpoch === value.ownerEpoch &&
        value.pending.prepared.intentFingerprint === value.legacy.intentFingerprint &&
        value.pending.prepared.preparedAtMs >= value.pending.issuedAtMs &&
        value.pending.prepared.preparedAtMs <= value.pending.expiresAtMs
      )) &&
      value.transfer === null && value.native === null && value.recovery === null;
  case PLAN_WATCH_OWNERSHIP_STATES.nativeOwned:
    return value.pending === null && validTransfer(value.transfer) && validNative(value.native) && value.recovery === null &&
      hasCommittedTicketTombstone(value.ticketTombstones, value.transfer);
  case PLAN_WATCH_OWNERSHIP_STATES.recoveryNeeded:
    return value.pending === null && validTransfer(value.transfer) && validNative(value.native) && validRecovery(value.recovery) &&
      value.recovery.priorOwnerEpoch < value.ownerEpoch && hasCommittedTicketTombstone(value.ticketTombstones, value.transfer);
  default:
    return false;
  }
}

function samePreparedTransfer(left, right) {
  return left.transferId === right.transferId &&
    left.ticketId === right.ticketId && left.ticketFingerprint === right.ticketFingerprint &&
    left.expectedOwnerEpoch === right.expectedOwnerEpoch &&
    left.intentFingerprint === right.intentFingerprint &&
    left.nativeOwnerFingerprint === right.nativeOwnerFingerprint &&
    left.nativeChannelFingerprint === right.nativeChannelFingerprint &&
    left.preparedAtMs === right.preparedAtMs;
}

function validPreparedBinding(value) {
  return exactKeys(value, [
    "transferId", "expectedOwnerEpoch", "intentFingerprint", "nativeOwnerFingerprint", "nativeChannelFingerprint", "preparedAtMs"
  ]) && validFingerprint(value.transferId) && validEpoch(value.expectedOwnerEpoch) &&
    validFingerprint(value.intentFingerprint) && validFingerprint(value.nativeOwnerFingerprint) &&
    validFingerprint(value.nativeChannelFingerprint) && validTimestamp(value.preparedAtMs);
}

function ticketWasRetired(tombstones, ticketId, ticketFingerprint) {
  return tombstones.some(tombstone => tombstone.ticketId === ticketId || tombstone.ticketFingerprint === ticketFingerprint);
}

function retireTicket(next, pending, reason, retiredAtMs) {
  if (!validTimestamp(retiredAtMs) || ticketWasRetired(next.ticketTombstones, pending.ticketId, pending.ticketFingerprint) ||
      next.ticketTombstones.length >= MAX_TICKET_TOMBSTONES) {
    return false;
  }
  next.ticketTombstones.push({
    ticketId: pending.ticketId,
    ticketFingerprint: pending.ticketFingerprint,
    retiredAtMs,
    reason
  });
  return true;
}

function ticketTimingFailureReason(pending, nowMs) {
  if (nowMs < pending.issuedAtMs) return "ticket-not-yet-valid";
  if (nowMs > pending.expiresAtMs) return "ticket-expired";
  return "ticket-mismatch";
}

function validPreparedTransfer(value) {
  return exactKeys(value, [
    "version", "ticketId", "ticketFingerprint", "transferId", "expectedOwnerEpoch", "intentFingerprint",
    "nativeOwnerFingerprint", "nativeChannelFingerprint", "preparedAtMs"
  ]) && value.version === PLAN_WATCH_OWNERSHIP_VERSION && validFingerprint(value.ticketId) &&
    validFingerprint(value.ticketFingerprint) && validFingerprint(value.transferId) && validEpoch(value.expectedOwnerEpoch) &&
    validFingerprint(value.intentFingerprint) && validFingerprint(value.nativeOwnerFingerprint) &&
    validFingerprint(value.nativeChannelFingerprint) && validTimestamp(value.preparedAtMs);
}

function pendingTicketMatches(pending, input, nowMs) {
  return validTimestamp(nowMs) && pending.ticketId === input.ticketId &&
    pending.ticketFingerprint === input.ticketFingerprint && nowMs >= pending.issuedAtMs && nowMs <= pending.expiresAtMs;
}

function baseState({ legacySubscriptionFingerprint, intentFingerprint, baselineMetadata = null, dedupeMetadata = null }) {
  return {
    version: PLAN_WATCH_OWNERSHIP_VERSION,
    state: PLAN_WATCH_OWNERSHIP_STATES.legacyOwned,
    ownerEpoch: 1,
    legacy: { subscriptionFingerprint: legacySubscriptionFingerprint, intentFingerprint },
    opaque: { baselineMetadata: clone(baselineMetadata), dedupeMetadata: clone(dedupeMetadata) },
    ticketTombstones: [],
    pending: null,
    transfer: null,
    native: null,
    recovery: null
  };
}

/** Creates a checked, legacy-owned record. It does not create delivery. */
export function createLegacyOwnershipState(input = {}) {
  if (!isObject(input) || !Object.keys(input).every(key => [
    "legacySubscriptionFingerprint", "intentFingerprint", "baselineMetadata", "dedupeMetadata"
  ].includes(key)) || !validFingerprint(input.legacySubscriptionFingerprint) || !validFingerprint(input.intentFingerprint) ||
      (Object.hasOwn(input, "baselineMetadata") && !validOpaqueMetadata(input.baselineMetadata)) ||
      (Object.hasOwn(input, "dedupeMetadata") && !validOpaqueMetadata(input.dedupeMetadata))) {
    return failure("invalid-legacy-state");
  }
  return success(baseState(input));
}

/** Explicitly starts one short-lived ownership-transfer attempt. */
export function issueNativeTransferTicket(state, input = {}) {
  if (!validState(state)) return failure("invalid-state");
  if (!exactKeys(input, ["ticketId", "ticketFingerprint", "issuedAtMs", "expiresAtMs"]) ||
      !validFingerprint(input.ticketId) || !validFingerprint(input.ticketFingerprint) || !validTimestamp(input.issuedAtMs) ||
      !validTimestamp(input.expiresAtMs) || input.expiresAtMs <= input.issuedAtMs ||
      input.expiresAtMs - input.issuedAtMs > MAX_TICKET_TTL_MS) {
    return failure("invalid-ticket");
  }
  if (state.state === PLAN_WATCH_OWNERSHIP_STATES.nativeTransferPending) {
    const pending = state.pending;
    const sameTicket = pending.ticketId === input.ticketId && pending.ticketFingerprint === input.ticketFingerprint &&
      pending.issuedAtMs === input.issuedAtMs && pending.expiresAtMs === input.expiresAtMs;
    return sameTicket ? success(state, { idempotent: true }) : failure("legacy-owner-required");
  }
  if (state.state !== PLAN_WATCH_OWNERSHIP_STATES.legacyOwned) return failure("legacy-owner-required");
  if (ticketWasRetired(state.ticketTombstones, input.ticketId, input.ticketFingerprint)) return failure("ticket-reused");
  if (state.ticketTombstones.length >= MAX_TICKET_TOMBSTONES) return failure("ticket-tombstone-capacity-exhausted");
  const next = clone(state);
  next.state = PLAN_WATCH_OWNERSHIP_STATES.nativeTransferPending;
  next.pending = {
    ticketId: input.ticketId,
    ticketFingerprint: input.ticketFingerprint,
    expectedOwnerEpoch: state.ownerEpoch,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
    intentFingerprint: state.legacy.intentFingerprint,
    prepared: null
  };
  return validState(next) ? success(next) : failure("invalid-transition");
}

/** Cancels/clears a pending attempt without changing legacy delivery ownership. */
export function cancelNativeTransferTicket(state, input = {}) {
  if (!validState(state)) return failure("invalid-state");
  if (state.state !== PLAN_WATCH_OWNERSHIP_STATES.nativeTransferPending) return failure("pending-transfer-required");
  if (!exactKeys(input, ["ticketId", "ticketFingerprint", "nowMs"]) || !validFingerprint(input.ticketId) ||
      !validFingerprint(input.ticketFingerprint) || state.pending.ticketId !== input.ticketId ||
      state.pending.ticketFingerprint !== input.ticketFingerprint || !validTimestamp(input.nowMs)) {
    return failure("ticket-mismatch");
  }
  if (input.nowMs < state.pending.issuedAtMs) return failure("ticket-not-yet-valid");
  const next = clone(state);
  if (!retireTicket(next, next.pending, "cancelled", input.nowMs)) return failure("ticket-retirement-failed");
  next.state = PLAN_WATCH_OWNERSHIP_STATES.legacyOwned;
  next.pending = null;
  return validState(next) ? success(next) : failure("invalid-transition");
}

/** Expiry clears a stale pending ticket but preserves a replay tombstone. */
export function expireNativeTransferTicket(state, input = {}) {
  if (!validState(state)) return failure("invalid-state");
  if (state.state !== PLAN_WATCH_OWNERSHIP_STATES.nativeTransferPending) return failure("pending-transfer-required");
  if (!exactKeys(input, ["nowMs"]) || !validTimestamp(input.nowMs)) return failure("invalid-expiry-request");
  if (input.nowMs <= state.pending.expiresAtMs) return failure("ticket-not-expired");
  const next = clone(state);
  if (!retireTicket(next, next.pending, "expired", input.nowMs)) return failure("ticket-retirement-failed");
  next.state = PLAN_WATCH_OWNERSHIP_STATES.legacyOwned;
  next.pending = null;
  return validState(next) ? success(next) : failure("invalid-transition");
}

/**
 * Builds a bounded prepared transfer. This is a review/validation result only;
 * it neither claims an owner nor sends a notification.
 */
export function prepareNativeTransfer(state, input = {}) {
  if (!validState(state)) return failure("invalid-state");
  if (state.state !== PLAN_WATCH_OWNERSHIP_STATES.nativeTransferPending) return failure("pending-transfer-required");
  if (!exactKeys(input, [
    "ticketId", "ticketFingerprint", "transferId", "expectedOwnerEpoch", "intentFingerprint",
    "nativeOwnerFingerprint", "nativeChannelFingerprint", "nowMs"
  ]) || !validFingerprint(input.ticketId) || !validFingerprint(input.ticketFingerprint) ||
      !validFingerprint(input.transferId) || !validEpoch(input.expectedOwnerEpoch) || !validFingerprint(input.intentFingerprint) ||
      !validFingerprint(input.nativeOwnerFingerprint) || !validFingerprint(input.nativeChannelFingerprint) || !validTimestamp(input.nowMs)) {
    return failure("invalid-prepare-request");
  }
  if (!pendingTicketMatches(state.pending, input, input.nowMs)) {
    return failure(ticketTimingFailureReason(state.pending, input.nowMs));
  }
  if (input.expectedOwnerEpoch !== state.ownerEpoch || input.intentFingerprint !== state.legacy.intentFingerprint) {
    return failure("owner-arbitration-failed");
  }
  const prepared = {
    version: PLAN_WATCH_OWNERSHIP_VERSION,
    ticketId: input.ticketId,
    ticketFingerprint: input.ticketFingerprint,
    transferId: input.transferId,
    expectedOwnerEpoch: input.expectedOwnerEpoch,
    intentFingerprint: input.intentFingerprint,
    nativeOwnerFingerprint: input.nativeOwnerFingerprint,
    nativeChannelFingerprint: input.nativeChannelFingerprint,
    preparedAtMs: input.nowMs
  };
  if (!validPreparedTransfer(prepared)) return failure("invalid-prepare-request");
  if (state.pending.prepared !== null) {
    const existing = {
      version: PLAN_WATCH_OWNERSHIP_VERSION,
      ticketId: state.pending.ticketId,
      ticketFingerprint: state.pending.ticketFingerprint,
      ...state.pending.prepared
    };
    return samePreparedTransfer(prepared, existing)
      ? success(state, { prepared: clone(existing), idempotent: true })
      : failure("transfer-already-prepared");
  }
  const next = clone(state);
  next.pending.prepared = {
    transferId: prepared.transferId,
    expectedOwnerEpoch: prepared.expectedOwnerEpoch,
    intentFingerprint: prepared.intentFingerprint,
    nativeOwnerFingerprint: prepared.nativeOwnerFingerprint,
    nativeChannelFingerprint: prepared.nativeChannelFingerprint,
    preparedAtMs: prepared.preparedAtMs
  };
  return validState(next) ? success(next, { prepared: clone(prepared), idempotent: false }) : failure("invalid-transition");
}

/**
 * Commits an already prepared transfer. The caller must provide a real atomic
 * server coordinator later; this pure model only defines the state it must
 * commit. A matching retry is idempotent, while every other replay fails.
 */
export function commitNativeTransfer(state, prepared, input = {}) {
  if (!validState(state)) return failure("invalid-state");
  if (!validPreparedTransfer(prepared) || !exactKeys(input, ["nowMs"]) || !validTimestamp(input.nowMs)) {
    return failure("invalid-commit-request");
  }

  if (state.state === PLAN_WATCH_OWNERSHIP_STATES.nativeOwned) {
    const replay = {
      version: PLAN_WATCH_OWNERSHIP_VERSION,
      transferId: state.transfer.transferId,
      ticketId: state.transfer.ticketId,
      ticketFingerprint: state.transfer.ticketFingerprint,
      expectedOwnerEpoch: state.transfer.previousOwnerEpoch,
      intentFingerprint: state.transfer.intentFingerprint,
      nativeOwnerFingerprint: state.native.ownerFingerprint,
      nativeChannelFingerprint: state.native.channelFingerprint,
      preparedAtMs: state.transfer.preparedAtMs
    };
    return samePreparedTransfer(prepared, replay) ? success(state, { idempotent: true }) : failure("transfer-already-committed");
  }

  if (state.state !== PLAN_WATCH_OWNERSHIP_STATES.nativeTransferPending) return failure("pending-transfer-required");
  if (!pendingTicketMatches(state.pending, prepared, input.nowMs)) {
    return failure(ticketTimingFailureReason(state.pending, input.nowMs));
  }
  if (prepared.expectedOwnerEpoch !== state.ownerEpoch || prepared.intentFingerprint !== state.legacy.intentFingerprint ||
      prepared.ticketId !== state.pending.ticketId || prepared.ticketFingerprint !== state.pending.ticketFingerprint) {
    return failure("owner-arbitration-failed");
  }
  if (state.pending.prepared === null) return failure("transfer-not-prepared");
  const boundPrepared = {
    version: PLAN_WATCH_OWNERSHIP_VERSION,
    ticketId: state.pending.ticketId,
    ticketFingerprint: state.pending.ticketFingerprint,
    ...state.pending.prepared
  };
  if (!samePreparedTransfer(prepared, boundPrepared)) return failure("prepared-transfer-mismatch");
  if (input.nowMs < prepared.preparedAtMs) return failure("commit-before-prepare");
  const next = clone(state);
  const previousOwnerEpoch = next.ownerEpoch;
  if (!retireTicket(next, next.pending, "committed", input.nowMs)) return failure("ticket-retirement-failed");
  next.ownerEpoch += 1;
  next.state = PLAN_WATCH_OWNERSHIP_STATES.nativeOwned;
  next.pending = null;
  next.transfer = {
    transferId: prepared.transferId,
    ticketId: prepared.ticketId,
    ticketFingerprint: prepared.ticketFingerprint,
    preparedAtMs: prepared.preparedAtMs,
    committedAtMs: input.nowMs,
    previousOwnerEpoch,
    intentFingerprint: prepared.intentFingerprint
  };
  next.native = {
    ownerFingerprint: prepared.nativeOwnerFingerprint,
    channelFingerprint: prepared.nativeChannelFingerprint,
    intentFingerprint: prepared.intentFingerprint
  };
  return validState(next) ? success(next, { idempotent: false }) : failure("invalid-transition");
}

/** Legacy writes remain possible only while legacy is still the owner. */
export function applyLegacyOwnershipUpdate(state, input = {}) {
  if (!validState(state)) return failure("invalid-state");
  if (state.state === PLAN_WATCH_OWNERSHIP_STATES.nativeOwned) return failure("native-owner-active");
  if (state.state !== PLAN_WATCH_OWNERSHIP_STATES.legacyOwned) return failure("legacy-owner-required");
  if (!exactKeys(input, ["expectedOwnerEpoch", "intentFingerprint", "baselineMetadata", "dedupeMetadata"]) ||
      !validEpoch(input.expectedOwnerEpoch) || !validFingerprint(input.intentFingerprint) ||
      !validOpaqueMetadata(input.baselineMetadata) || !validOpaqueMetadata(input.dedupeMetadata)) {
    return failure("invalid-legacy-update");
  }
  if (input.expectedOwnerEpoch !== state.ownerEpoch) return failure("owner-arbitration-failed");
  const next = clone(state);
  next.ownerEpoch += 1;
  next.legacy.intentFingerprint = input.intentFingerprint;
  next.opaque = { baselineMetadata: clone(input.baselineMetadata), dedupeMetadata: clone(input.dedupeMetadata) };
  return validState(next) ? success(next) : failure("invalid-transition");
}

/** Native updates must present the active opaque owner fingerprint and epoch. */
export function applyNativeOwnershipUpdate(state, input = {}) {
  if (!validState(state)) return failure("invalid-state");
  if (state.state !== PLAN_WATCH_OWNERSHIP_STATES.nativeOwned) return failure("native-owner-required");
  if (!exactKeys(input, [
    "expectedOwnerEpoch", "nativeOwnerFingerprint", "intentFingerprint", "baselineMetadata", "dedupeMetadata"
  ]) || !validEpoch(input.expectedOwnerEpoch) || !validFingerprint(input.nativeOwnerFingerprint) ||
      !validFingerprint(input.intentFingerprint) || !validOpaqueMetadata(input.baselineMetadata) ||
      !validOpaqueMetadata(input.dedupeMetadata)) {
    return failure("invalid-native-update");
  }
  if (input.expectedOwnerEpoch !== state.ownerEpoch || input.nativeOwnerFingerprint !== state.native.ownerFingerprint) {
    return failure("owner-arbitration-failed");
  }
  const next = clone(state);
  next.ownerEpoch += 1;
  next.native.intentFingerprint = input.intentFingerprint;
  next.opaque = { baselineMetadata: clone(input.baselineMetadata), dedupeMetadata: clone(input.dedupeMetadata) };
  return validState(next) ? success(next) : failure("invalid-transition");
}

/** Loss of native ownership evidence fails closed; it never resurrects legacy. */
export function markRecoveryNeeded(state, input = {}) {
  if (!validState(state)) return failure("invalid-state");
  if (state.state !== PLAN_WATCH_OWNERSHIP_STATES.nativeOwned) return failure("native-owner-required");
  if (!exactKeys(input, ["expectedOwnerEpoch", "nativeOwnerFingerprint", "reasonFingerprint", "nowMs"]) ||
      !validEpoch(input.expectedOwnerEpoch) || !validFingerprint(input.nativeOwnerFingerprint) ||
      !validFingerprint(input.reasonFingerprint) || !validTimestamp(input.nowMs)) {
    return failure("invalid-recovery-request");
  }
  if (input.expectedOwnerEpoch !== state.ownerEpoch || input.nativeOwnerFingerprint !== state.native.ownerFingerprint) {
    return failure("owner-arbitration-failed");
  }
  const next = clone(state);
  const priorOwnerEpoch = next.ownerEpoch;
  next.ownerEpoch += 1;
  next.state = PLAN_WATCH_OWNERSHIP_STATES.recoveryNeeded;
  next.recovery = { reasonFingerprint: input.reasonFingerprint, enteredAtMs: input.nowMs, priorOwnerEpoch };
  return validState(next) ? success(next) : failure("invalid-transition");
}

/**
 * The eventual evaluator must ask this immediately before delivery. Pending
 * transfers and recovery states intentionally have no eligible owner.
 */
export function deliveryEligibility(state, input = {}) {
  if (!validState(state)) return failure("invalid-state");
  if (!exactKeys(input, ["owner", "ownerEpoch", "intentFingerprint", "ownerFingerprint"]) ||
      !["legacy", "native"].includes(input.owner) || !validEpoch(input.ownerEpoch) ||
      !validFingerprint(input.intentFingerprint) ||
      (input.owner === "native" && !validFingerprint(input.ownerFingerprint)) ||
      (input.owner === "legacy" && input.ownerFingerprint !== null)) {
    return failure("invalid-delivery-claim");
  }
  if (state.state === PLAN_WATCH_OWNERSHIP_STATES.legacyOwned) {
    const eligible = input.owner === "legacy" && input.ownerEpoch === state.ownerEpoch &&
      input.intentFingerprint === state.legacy.intentFingerprint;
    return { ok: true, eligible, reason: eligible ? "eligible" : "owner-arbitration-failed" };
  }
  if (state.state === PLAN_WATCH_OWNERSHIP_STATES.nativeOwned) {
    const eligible = input.owner === "native" && input.ownerEpoch === state.ownerEpoch &&
      input.intentFingerprint === state.native.intentFingerprint && input.ownerFingerprint === state.native.ownerFingerprint;
    return { ok: true, eligible, reason: eligible ? "eligible" : "owner-arbitration-failed" };
  }
  return { ok: true, eligible: false, reason: state.state === PLAN_WATCH_OWNERSHIP_STATES.nativeTransferPending
    ? "transfer-pending" : "recovery-needed" };
}

/** Exposed for deterministic fixtures; it does not authorize a live worker. */
export function isValidPlanWatchOwnershipState(state) {
  return validState(state);
}
