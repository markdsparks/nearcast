import assert from "node:assert/strict";
import {
  PLAN_WATCH_OWNERSHIP_STATES,
  applyLegacyOwnershipUpdate,
  applyNativeOwnershipUpdate,
  cancelNativeTransferTicket,
  commitNativeTransfer,
  createLegacyOwnershipState,
  deliveryEligibility,
  expireNativeTransferTicket,
  isValidPlanWatchOwnershipState,
  issueNativeTransferTicket,
  markRecoveryNeeded,
  prepareNativeTransfer
} from "../workers/plan-watch-ownership.mjs";

const at = 1_750_000_000_000;
const fingerprint = label => `sha256:${label.padEnd(57, "x")}`;
const legacySubscription = fingerprint("legacy-subscription");
const legacyIntent = fingerprint("legacy-intent");
const nativeIntent = fingerprint("native-intent");
const ticketId = fingerprint("ticket-id");
const ticketFingerprint = fingerprint("ticket-fingerprint");
const replacementTicketId = fingerprint("replacement-ticket-id");
const replacementTicketFingerprint = fingerprint("replacement-ticket-fingerprint");
const expiryTicketId = fingerprint("expiry-ticket-id");
const expiryTicketFingerprint = fingerprint("expiry-ticket-fingerprint");
const transferId = fingerprint("transfer-id");
const nativeOwner = fingerprint("native-owner");
const nativeChannel = fingerprint("native-channel");
const recoveryReason = fingerprint("keychain-lost");

function expectFailure(result, reason, message) {
  assert.equal(result.ok, false, message);
  assert.equal(result.reason, reason, message);
}

function ticketInput(overrides = {}) {
  return {
    ticketId,
    ticketFingerprint,
    issuedAtMs: at,
    expiresAtMs: at + 5 * 60 * 1000,
    ...overrides
  };
}

function replacementTicketInput(overrides = {}) {
  return {
    ticketId: replacementTicketId,
    ticketFingerprint: replacementTicketFingerprint,
    issuedAtMs: at + 10,
    expiresAtMs: at + 5 * 60 * 1000 + 10,
    ...overrides
  };
}

function expiryTicketInput(overrides = {}) {
  return {
    ticketId: expiryTicketId,
    ticketFingerprint: expiryTicketFingerprint,
    issuedAtMs: at + 20,
    expiresAtMs: at + 5 * 60 * 1000 + 20,
    ...overrides
  };
}

function prepareInput(overrides = {}) {
  return {
    ticketId,
    ticketFingerprint,
    transferId,
    expectedOwnerEpoch: 1,
    intentFingerprint: legacyIntent,
    nativeOwnerFingerprint: nativeOwner,
    nativeChannelFingerprint: nativeChannel,
    nowMs: at + 1,
    ...overrides
  };
}

const opaqueBaseline = { version: 9, untouched: { candidate: "old-baseline" } };
const opaqueDedupe = { entries: ["prior-send"], doNotInterpret: true };
const initialResult = createLegacyOwnershipState({
  legacySubscriptionFingerprint: legacySubscription,
  intentFingerprint: legacyIntent,
  baselineMetadata: opaqueBaseline,
  dedupeMetadata: opaqueDedupe
});
assert.equal(initialResult.ok, true, "a bounded legacy state can be created");
const initial = initialResult.state;
assert.equal(initial.state, PLAN_WATCH_OWNERSHIP_STATES.legacyOwned);
assert.equal(isValidPlanWatchOwnershipState(initial), true);
assert.deepEqual(initial.opaque.baselineMetadata, opaqueBaseline, "baseline is retained opaquely");
assert.deepEqual(initial.opaque.dedupeMetadata, opaqueDedupe, "dedupe is retained opaquely");

expectFailure(createLegacyOwnershipState({
  legacySubscriptionFingerprint: "not-a-fingerprint",
  intentFingerprint: legacyIntent
}), "invalid-legacy-state", "malformed initial state fails closed");

const legacyCanSend = deliveryEligibility(initial, {
  owner: "legacy", ownerEpoch: 1, intentFingerprint: legacyIntent, ownerFingerprint: null
});
assert.deepEqual(legacyCanSend, { ok: true, eligible: true, reason: "eligible" }, "legacy is eligible before a transfer");

const pendingResult = issueNativeTransferTicket(initial, ticketInput());
assert.equal(pendingResult.ok, true, "ticket issuance begins an explicit pending transition");
const pending = pendingResult.state;
assert.equal(pending.state, PLAN_WATCH_OWNERSHIP_STATES.nativeTransferPending);
assert.equal(isValidPlanWatchOwnershipState(pending), true);
assert.equal(deliveryEligibility(pending, {
  owner: "legacy", ownerEpoch: 1, intentFingerprint: legacyIntent, ownerFingerprint: null
}).eligible, false, "pending transfers cannot send under the old epoch");
assert.equal(issueNativeTransferTicket(pending, ticketInput()).idempotent, true, "a dropped ticket-issuance response retries without issuing again");
expectFailure(issueNativeTransferTicket(pending, replacementTicketInput()), "legacy-owner-required", "a different second ticket cannot be issued while one is pending");
expectFailure(applyLegacyOwnershipUpdate(pending, {
  expectedOwnerEpoch: 1, intentFingerprint: nativeIntent, baselineMetadata: {}, dedupeMetadata: {}
}), "legacy-owner-required", "legacy writes cannot race a pending transfer");

expectFailure(prepareNativeTransfer(pending, prepareInput({ nowMs: at + 5 * 60 * 1000 + 1 })), "ticket-expired", "expired tickets are rejected");
expectFailure(prepareNativeTransfer(pending, prepareInput({ nowMs: at - 1 })), "ticket-not-yet-valid", "a ticket cannot be prepared before issuance");
expectFailure(prepareNativeTransfer(pending, prepareInput({ ticketFingerprint: fingerprint("wrong-ticket") })), "ticket-mismatch", "tickets bind their opaque fingerprint");
expectFailure(prepareNativeTransfer(pending, prepareInput({ expectedOwnerEpoch: 2 })), "owner-arbitration-failed", "prepare binds the current owner epoch");

const prepareResult = prepareNativeTransfer(pending, prepareInput());
assert.equal(prepareResult.ok, true, "an exact current ticket prepares a transfer");
const prepared = prepareResult.prepared;
const preparedPending = prepareResult.state;
assert.equal(prepareResult.idempotent, false, "first prepare binds the transfer exactly once");
assert.equal(prepareNativeTransfer(preparedPending, prepareInput()).idempotent, true, "an exact prepare retry is idempotent");

expectFailure(commitNativeTransfer(preparedPending, { ...prepared, nativeChannelFingerprint: fingerprint("other-channel") }, { nowMs: at + 2 }),
  "prepared-transfer-mismatch", "tampering a prepared transfer cannot commit");
const committedResult = commitNativeTransfer(preparedPending, prepared, { nowMs: at + 2 });
assert.equal(committedResult.ok, true, "the exact prepared transfer commits");
assert.equal(committedResult.idempotent, false);
const nativeOwned = committedResult.state;
assert.equal(nativeOwned.state, PLAN_WATCH_OWNERSHIP_STATES.nativeOwned);
assert.equal(nativeOwned.ownerEpoch, 2, "commit advances the owner epoch exactly once");
assert.deepEqual(nativeOwned.opaque, initial.opaque, "commit preserves opaque baseline and dedupe metadata");
assert.equal(isValidPlanWatchOwnershipState(nativeOwned), true);
assert.equal(nativeOwned.ticketTombstones.at(-1).reason, "committed", "a committed ticket receives a replay tombstone");
assert.equal(isValidPlanWatchOwnershipState({ ...nativeOwned, ticketTombstones: [] }), false,
  "native ownership without its committed-ticket tombstone fails closed");

const committedRetry = commitNativeTransfer(nativeOwned, prepared, { nowMs: at + 3 });
assert.equal(committedRetry.ok, true, "dropped-response retry is idempotent");
assert.equal(committedRetry.idempotent, true);
expectFailure(prepareNativeTransfer(nativeOwned, prepareInput()), "pending-transfer-required", "consumed ticket cannot be replayed into a new prepare");
expectFailure(commitNativeTransfer(nativeOwned, { ...prepared, transferId: fingerprint("replayed-transfer") }, { nowMs: at + 3 }),
  "transfer-already-committed", "a different replay cannot replace native ownership");
expectFailure(applyLegacyOwnershipUpdate(nativeOwned, {
  expectedOwnerEpoch: 2, intentFingerprint: nativeIntent, baselineMetadata: {}, dedupeMetadata: {}
}), "native-owner-active", "legacy updates are rejected after native ownership begins");

assert.equal(deliveryEligibility(nativeOwned, {
  owner: "legacy", ownerEpoch: 1, intentFingerprint: legacyIntent, ownerFingerprint: null
}).eligible, false, "the old owner loses delivery eligibility");
assert.equal(deliveryEligibility(nativeOwned, {
  owner: "native", ownerEpoch: 2, intentFingerprint: legacyIntent, ownerFingerprint: nativeOwner
}).eligible, true, "native has the committed owner epoch");

const nativeUpdateResult = applyNativeOwnershipUpdate(nativeOwned, {
  expectedOwnerEpoch: 2,
  nativeOwnerFingerprint: nativeOwner,
  intentFingerprint: nativeIntent,
  baselineMetadata: { retained: "opaque-baseline-v2" },
  dedupeMetadata: { retained: "opaque-dedupe-v2" }
});
assert.equal(nativeUpdateResult.ok, true, "only the active native owner can update its state");
const nativeUpdated = nativeUpdateResult.state;
assert.equal(nativeUpdated.ownerEpoch, 3, "native mutations advance the delivery fence");
assert.equal(deliveryEligibility(nativeUpdated, {
  owner: "native", ownerEpoch: 2, intentFingerprint: legacyIntent, ownerFingerprint: nativeOwner
}).eligible, false, "an in-flight evaluator must lose an older epoch");
assert.equal(deliveryEligibility(nativeUpdated, {
  owner: "native", ownerEpoch: 3, intentFingerprint: nativeIntent, ownerFingerprint: nativeOwner
}).eligible, true, "the current native owner can claim delivery");

const recoveryResult = markRecoveryNeeded(nativeUpdated, {
  expectedOwnerEpoch: 3,
  nativeOwnerFingerprint: nativeOwner,
  reasonFingerprint: recoveryReason,
  nowMs: at + 4
});
assert.equal(recoveryResult.ok, true, "a lost native ownership proof enters recovery rather than reviving legacy");
const recovery = recoveryResult.state;
assert.equal(recovery.state, PLAN_WATCH_OWNERSHIP_STATES.recoveryNeeded);
assert.equal(deliveryEligibility(recovery, {
  owner: "native", ownerEpoch: recovery.ownerEpoch, intentFingerprint: nativeIntent, ownerFingerprint: nativeOwner
}).eligible, false, "recovery blocks delivery until a future explicit recovery protocol exists");
assert.equal(deliveryEligibility(recovery, {
  owner: "legacy", ownerEpoch: 1, intentFingerprint: legacyIntent, ownerFingerprint: null
}).eligible, false, "recovery never silently resurrects legacy delivery");

const cancelled = cancelNativeTransferTicket(pending, { ticketId, ticketFingerprint, nowMs: at + 3 });
assert.equal(cancelled.ok, true, "a cancelled transfer returns to legacy ownership");
assert.equal(cancelled.state.state, PLAN_WATCH_OWNERSHIP_STATES.legacyOwned);
assert.equal(cancelled.state.ticketTombstones.at(-1).reason, "cancelled", "cancellation preserves a replay tombstone");
assert.equal(deliveryEligibility(cancelled.state, {
  owner: "legacy", ownerEpoch: 1, intentFingerprint: legacyIntent, ownerFingerprint: null
}).eligible, true, "cancellation leaves legacy delivery intact");
expectFailure(issueNativeTransferTicket(cancelled.state, ticketInput()), "ticket-reused", "a cancelled ticket cannot be issued again");

const replacementPendingResult = issueNativeTransferTicket(cancelled.state, replacementTicketInput());
assert.equal(replacementPendingResult.ok, true, "a new opaque ticket can begin a later transfer attempt");
const replacementPending = replacementPendingResult.state;
expectFailure(expireNativeTransferTicket(replacementPending, { nowMs: at + 10 }), "ticket-not-expired", "an active ticket cannot be expired early");
const expired = expireNativeTransferTicket(replacementPending, { nowMs: at + 5 * 60 * 1000 + 11 });
assert.equal(expired.ok, true, "an expired ticket returns safely to legacy ownership");
expectFailure(issueNativeTransferTicket(expired.state, replacementTicketInput()), "ticket-reused", "an expired ticket cannot be replayed");
assert.equal(issueNativeTransferTicket(expired.state, expiryTicketInput()).ok, true, "expiry permits a different new ticket");

console.log("Plan Watch ownership protocol model passed: explicit ticket, epoch-fenced handoff, idempotent commit, and fail-closed recovery.");
