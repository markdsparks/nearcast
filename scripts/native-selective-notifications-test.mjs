import assert from 'node:assert/strict';
import {
  normalizeNativeNotificationPolicy, planWatchCandidateInCooldown,
  planWatchCandidateInQuietHours, planWatchPersistedEvaluationTargets
} from '../workers/radar-capability.mjs';
const policy = { quietStart: 21, quietEnd: 8, minimumIntervalMinutes: 180 };
const now = new Date('2026-11-01T07:30:00Z'); // second 01:30 after Chicago's fall-back
const routine = { type: 'plan-rain', priority: 80, notification: { memoryId: 'walk' } };
const warning = { type: 'plan-alert', priority: 140, notification: { memoryId: 'walk' } };
const record = { client: { owner: 'native-v1', timezone: 'America/Chicago', notificationPolicy: policy },
  lastRoutineSentAt: new Date(now - 60_000).toISOString() };
assert.deepEqual(normalizeNativeNotificationPolicy(policy), policy);
for (const bad of [null, {}, { ...policy, quietStart: -1 }, { ...policy, quietEnd: 24 },
  { ...policy, quietStart: 21.5 }, { ...policy, minimumIntervalMinutes: 0 },
  { ...policy, minimumIntervalMinutes: '180' }]) assert.equal(normalizeNativeNotificationPolicy(bad), null);
assert.equal(planWatchCandidateInQuietHours(record, routine, {}, now), true);
assert.equal(planWatchCandidateInQuietHours(record, routine, {}, new Date('2026-11-01T06:30:00Z')), true,
  'both repeated fall-back hours are quiet');
assert.equal(planWatchCandidateInQuietHours(record, routine, {}, new Date('2026-11-01T14:00:00Z')), false,
  'quiet hours end at the place-independent device-local clock');
assert.equal(planWatchCandidateInQuietHours(record, warning, {}, now), false);
assert.equal(planWatchCandidateInQuietHours(record, { ...routine, priority: 200 }, {}, now), true,
  'ordinary forecast risk cannot masquerade as an urgent official warning');
assert.equal(planWatchCandidateInQuietHours({ client: { ...record.client, notificationPolicy: { ...policy, quietStart: 8, quietEnd: 8 } } }, routine, {}, now), false);
assert.equal(planWatchCandidateInQuietHours({ client: { ...record.client, notificationPolicy: { ...policy, quietStart: 9, quietEnd: 17 } } }, routine, {}, new Date('2026-11-01T16:00:00Z')), true,
  'same-day quiet intervals work');
assert.equal(planWatchCandidateInCooldown(record, routine, now), true);
assert.equal(planWatchCandidateInCooldown(record, warning, now), false);
assert.equal(planWatchCandidateInCooldown(record, { ...routine, priority: 200 }, now), true);
assert.equal(planWatchCandidateInCooldown(record, routine, new Date(Date.parse(record.lastRoutineSentAt) + 180 * 60_000)), false);
assert.equal(planWatchCandidateInCooldown({ ...record, lastRoutineSentAt: 'invalid' }, routine, now), false);
assert.equal(planWatchCandidateInCooldown({ ...record, lastRoutineSentAt: new Date(+now + 60_000).toISOString() }, routine, now), false);
assert.equal(planWatchCandidateInCooldown({ ...record, client: { ...record.client, owner: undefined } }, routine, now), false,
  'legacy clients retain their delivery behavior');
const previous = { id: 'walk', lastKnown: { snapshot: { rainChance: 10 } } };
const updated = { id: 'walk', lastKnown: { snapshot: { rainChance: 80 } } };
const deferred = planWatchPersistedEvaluationTargets({ plans: [previous], evaluatedPlans: [updated], candidates: [routine] });
assert.deepEqual(deferred.plans, [previous], 'quiet/cooldown deferral retains the material comparison baseline');
assert.equal(deferred.deferred, 1);
const delivered = planWatchPersistedEvaluationTargets({ plans: [previous], evaluatedPlans: [updated], candidates: [routine], deliveredCandidate: routine });
assert.deepEqual(delivered.plans, [updated]);
console.log('PASS selective notification policy: validation, device time zone, DST, quiet hours, urgent bypass, cooldown and deferred baselines');
